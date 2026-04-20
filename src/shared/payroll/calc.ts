/**
 * Korean payroll calculation — pure functions.
 *
 * NOTE ON ACCURACY
 * ----------------
 * This module is intentionally a *reasonable approximation* of Korean payroll
 * rules, not a legally certified calculation engine. It exists so managers can
 * prepare draft payslips and see expected take-home pay inside the portal. For
 * official filings, cross-reference with NTS 간이세액표 / 4대보험 공식 계산기.
 *
 * Rate sources (as of the 2026 April snapshot bundled with v0.1.4):
 *   - 국민연금    : 4.5% (근로자 부담분, 표준보수월액 상한 617만원 가정)
 *   - 건강보험    : 3.545%
 *   - 장기요양보험 : 건강보험료 × 12.95%
 *   - 고용보험    : 0.9% (근로자 부담, 150인 미만 가정)
 *   - 갑근세      : 간이세액 근사 — 월 과세급여 구간별 선형 근사식 (공제대상 가족 1명 기준)
 *   - 지방소득세  : 소득세의 10%
 *   - 프리랜서    : 사업소득 원천징수 3% + 지방세 0.3% = 3.3%
 *   - 비과세 한도 : 식대 월 20만원, 차량유지비 월 20만원 (실비 증빙 시)
 *
 * All monetary values are integer won (정수 원). Rounding uses `Math.floor` for
 * deductions (근로자에게 유리한 방향) and `Math.round` for gross aggregates.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Rate constants — exported so the UI can show "적용 요율" next to each field.
// ─────────────────────────────────────────────────────────────────────────────

export const RATES = {
  NATIONAL_PENSION: 0.045,            // 국민연금 근로자 부담
  HEALTH_INSURANCE: 0.03545,          // 건강보험 근로자 부담
  LONG_TERM_CARE: 0.1295,             // 장기요양 — 건강보험료 기준 요율
  EMPLOYMENT_INSURANCE: 0.009,        // 고용보험 근로자 부담 (일반)
  LOCAL_INCOME_TAX: 0.1,              // 지방소득세 = 소득세 × 10%
  FREELANCER_INCOME_TAX: 0.03,        // 프리랜서 원천징수 소득세
  FREELANCER_LOCAL_TAX: 0.003,        // 프리랜서 지방세 (= 소득세 × 10%)
  FREELANCER_TOTAL: 0.033,            // 합계 3.3%
} as const;

export const NONTAXABLE_CAPS = {
  MEAL_ALLOWANCE: 200_000,            // 식대 비과세 한도 (월)
  TRANSPORT_ALLOWANCE: 200_000,       // 자가운전보조금 비과세 한도 (월, 실비 증빙)
} as const;

/**
 * 국민연금 표준보수월액 상한 (2026 가정치). 실제 상한은 매년 공단이 고시함.
 * 상한을 넘는 보수에 대해서는 요율을 적용하지 않고 상한 기준으로 부과.
 */
export const NPS_MONTHLY_CAP = 6_170_000;

// ─────────────────────────────────────────────────────────────────────────────
// 갑근세 간이세액 근사
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 공제대상 가족 수별로 구간 근사치를 매우 단순화한 테이블입니다.
 * 정확한 값은 국세청 간이세액표를 사용해야 하지만, 화면에 draft 를 띄우는
 * 용도로 10만원 단위 월 과세급여 구간에 대해 연간 산출세액을 12 로 나눈
 * 값에 근사한 계수를 사용합니다.
 *
 * 공식: 월과세급여 × rate − deduction (음수이면 0)
 *
 * 실제 운영에서는 이 함수를 NTS CSV 를 파싱한 룩업 테이블로 교체 권장.
 */
interface TaxBracket {
  upTo: number;     // 월 과세급여 상한 (미포함), Infinity 가능
  rate: number;     // 근사 누진 요율
  deduction: number; // 누진공제액 (원)
}

/**
 * 근사치 테이블 — 공제대상 가족 1인 기준.
 * 경계값은 과세표준 × 12 구간을 월 기준으로 환산한 후 국민연금/건강보험
 * 평균 공제분을 제한 상태로 근사화했습니다.
 */
const WITHHOLDING_BRACKETS_1: TaxBracket[] = [
  { upTo: 1_060_000,  rate: 0,     deduction: 0 },
  { upTo: 1_500_000,  rate: 0.006, deduction: 6_360 },
  { upTo: 3_000_000,  rate: 0.015, deduction: 19_860 },
  { upTo: 4_500_000,  rate: 0.024, deduction: 46_860 },
  { upTo: 7_000_000,  rate: 0.035, deduction: 96_360 },
  { upTo: 10_000_000, rate: 0.038, deduction: 117_360 },
  { upTo: 15_000_000, rate: 0.040, deduction: 137_360 },
  { upTo: Infinity,   rate: 0.042, deduction: 167_360 },
];

/**
 * 공제대상 가족 수에 따른 월 세액 감면 (근사치, 매우 단순화).
 * 정확히는 간이세액표가 공제대상 수별로 완전히 다른 테이블을 제공하지만
 * UI draft 목적으로 1인 초과 1명당 월 12,500원 추가 공제로 근사합니다.
 */
const PER_DEPENDENT_RELIEF = 12_500;

export interface WithholdingInput {
  /** 월 과세 급여 (비과세 수당 제외) */
  taxableMonthly: number;
  /** 공제대상 가족 수 (본인 포함) — 최소 1. 기본 1. */
  dependents?: number;
}

export function calcIncomeTaxWithholding(input: WithholdingInput): number {
  const base = Math.max(0, Math.floor(input.taxableMonthly));
  if (base === 0) return 0;
  const bracket =
    WITHHOLDING_BRACKETS_1.find((b) => base < b.upTo) ??
    WITHHOLDING_BRACKETS_1[WITHHOLDING_BRACKETS_1.length - 1];
  const raw = base * bracket.rate - bracket.deduction;
  const dependents = Math.max(1, input.dependents ?? 1);
  const relief = (dependents - 1) * PER_DEPENDENT_RELIEF;
  const net = Math.max(0, Math.floor(raw - relief));
  // 10원 단위 반올림 (실무 관행)
  return Math.floor(net / 10) * 10;
}

// ─────────────────────────────────────────────────────────────────────────────
// 정규직 급여 계산
// ─────────────────────────────────────────────────────────────────────────────

export interface RegularPayrollProfile {
  /** 기본급 (월) */
  baseSalary: number;
  /** 고정 수당 — 과세 */
  positionAllowance?: number;
  /** 식대 (200,000 까지 비과세) */
  mealAllowance?: number;
  /** 차량유지비 (200,000 까지 비과세, 실비 증빙 가정) */
  transportAllowance?: number;
  /** 공제대상 가족 수 (본인 포함) */
  dependents?: number;
}

export interface RegularPayrollInputs {
  /** 초과근로수당 (과세) */
  overtimePay?: number;
  /** 상여금 (과세) */
  bonus?: number;
  /** 기타 과세 */
  otherTaxable?: number;
  /** 기타 비과세 */
  otherNontaxable?: number;
  /** 기타 공제 (경조사비 차감, 대출 상환 등) */
  otherDeduction?: number;
}

export interface RegularPayrollResult {
  // 지급 항목
  baseSalary: number;
  overtimePay: number;
  positionAllowance: number;
  mealAllowance: number;          // 실지급액
  transportAllowance: number;     // 실지급액
  bonus: number;
  otherTaxable: number;
  otherNontaxable: number;
  grossPay: number;               // 총 지급액
  // 과세 분할
  taxableBase: number;            // 과세 대상 합계
  nontaxableTotal: number;        // 비과세 합계
  // 4대보험 + 세금
  nationalPension: number;
  healthInsurance: number;
  longTermCare: number;
  employmentInsurance: number;
  incomeTax: number;
  localIncomeTax: number;
  otherDeduction: number;
  totalDeduction: number;
  // 실지급액
  netPay: number;
}

export function calcRegularPayroll(
  profile: RegularPayrollProfile,
  inputs: RegularPayrollInputs = {},
): RegularPayrollResult {
  const baseSalary = Math.max(0, Math.floor(profile.baseSalary));
  const overtimePay = Math.max(0, Math.floor(inputs.overtimePay ?? 0));
  const positionAllowance = Math.max(0, Math.floor(profile.positionAllowance ?? 0));
  const mealPaid = Math.max(0, Math.floor(profile.mealAllowance ?? 0));
  const transportPaid = Math.max(0, Math.floor(profile.transportAllowance ?? 0));
  const bonus = Math.max(0, Math.floor(inputs.bonus ?? 0));
  const otherTaxable = Math.max(0, Math.floor(inputs.otherTaxable ?? 0));
  const otherNontaxable = Math.max(0, Math.floor(inputs.otherNontaxable ?? 0));

  // 비과세 한도 적용
  const mealNontaxable = Math.min(mealPaid, NONTAXABLE_CAPS.MEAL_ALLOWANCE);
  const mealTaxable = mealPaid - mealNontaxable;
  const transportNontaxable = Math.min(transportPaid, NONTAXABLE_CAPS.TRANSPORT_ALLOWANCE);
  const transportTaxable = transportPaid - transportNontaxable;

  const taxableBase =
    baseSalary +
    overtimePay +
    positionAllowance +
    bonus +
    otherTaxable +
    mealTaxable +
    transportTaxable;

  const nontaxableTotal = mealNontaxable + transportNontaxable + otherNontaxable;
  const grossPay = taxableBase + nontaxableTotal;

  // 4대보험 (원단위 내림)
  const npsBase = Math.min(taxableBase, NPS_MONTHLY_CAP);
  const nationalPension = Math.floor(npsBase * RATES.NATIONAL_PENSION);
  const healthInsurance = Math.floor(taxableBase * RATES.HEALTH_INSURANCE);
  const longTermCare = Math.floor(healthInsurance * RATES.LONG_TERM_CARE);
  const employmentInsurance = Math.floor(taxableBase * RATES.EMPLOYMENT_INSURANCE);

  // 세금
  const incomeTax = calcIncomeTaxWithholding({
    taxableMonthly: taxableBase,
    dependents: profile.dependents,
  });
  const localIncomeTax = Math.floor(incomeTax * RATES.LOCAL_INCOME_TAX);

  const otherDeduction = Math.max(0, Math.floor(inputs.otherDeduction ?? 0));

  const totalDeduction =
    nationalPension +
    healthInsurance +
    longTermCare +
    employmentInsurance +
    incomeTax +
    localIncomeTax +
    otherDeduction;

  const netPay = grossPay - totalDeduction;

  return {
    baseSalary,
    overtimePay,
    positionAllowance,
    mealAllowance: mealPaid,
    transportAllowance: transportPaid,
    bonus,
    otherTaxable,
    otherNontaxable,
    grossPay,
    taxableBase,
    nontaxableTotal,
    nationalPension,
    healthInsurance,
    longTermCare,
    employmentInsurance,
    incomeTax,
    localIncomeTax,
    otherDeduction,
    totalDeduction,
    netPay,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 프리랜서 원천징수 (3.3%)
// ─────────────────────────────────────────────────────────────────────────────

export interface FreelancerPayrollResult {
  grossPay: number;
  incomeTax: number;          // 3%
  localIncomeTax: number;     // 0.3%
  totalWithholding: number;
  netPay: number;
}

export function calcFreelancerPayroll(grossPay: number): FreelancerPayrollResult {
  const gross = Math.max(0, Math.floor(grossPay));
  const incomeTax = Math.floor(gross * RATES.FREELANCER_INCOME_TAX);
  const localIncomeTax = Math.floor(incomeTax * 0.1); // 소득세의 10%
  const totalWithholding = incomeTax + localIncomeTax;
  const netPay = gross - totalWithholding;
  return { grossPay: gross, incomeTax, localIncomeTax, totalWithholding, netPay };
}

// ─────────────────────────────────────────────────────────────────────────────
// 단시간/일용 근로자
// ─────────────────────────────────────────────────────────────────────────────

export interface PartTimePayrollInput {
  hours: number;
  hourlyRate: number;
  /** 일용직으로 처리 시 true — 8.8% 단순 원천징수 근사. 기본 false (초단시간 근로자). */
  dailyWorker?: boolean;
  /** 초단시간 근로자로 분류되어 4대보험이 대부분 면제되는 경우 true. 기본 true. */
  exemptFromInsurance?: boolean;
}

export interface PartTimePayrollResult {
  grossPay: number;
  incomeTax: number;
  localIncomeTax: number;
  totalDeduction: number;
  netPay: number;
  note: string;
}

export function calcPartTimePayroll(input: PartTimePayrollInput): PartTimePayrollResult {
  const hours = Math.max(0, input.hours);
  const rate = Math.max(0, Math.floor(input.hourlyRate));
  const grossPay = Math.floor(hours * rate);

  if (input.dailyWorker) {
    // 일용근로자 간편 계산 — (일급 − 15만원) × 2.97% 의 근사를 월 합계에 적용.
    // 매우 단순화된 근사치입니다.
    const dailyDeduction = Math.max(0, grossPay - 150_000);
    const incomeTax = Math.floor(dailyDeduction * 0.027);
    const localIncomeTax = Math.floor(incomeTax * 0.1);
    const total = incomeTax + localIncomeTax;
    return {
      grossPay,
      incomeTax,
      localIncomeTax,
      totalDeduction: total,
      netPay: grossPay - total,
      note: '일용근로자 간편 계산 (근사)',
    };
  }

  if (input.exemptFromInsurance !== false) {
    // 초단시간 근로자 (주 15시간 미만 등) — 4대보험 적용 제외.
    // 일반 소득세 간이세액 근사를 적용.
    const incomeTax = calcIncomeTaxWithholding({ taxableMonthly: grossPay });
    const localIncomeTax = Math.floor(incomeTax * RATES.LOCAL_INCOME_TAX);
    const total = incomeTax + localIncomeTax;
    return {
      grossPay,
      incomeTax,
      localIncomeTax,
      totalDeduction: total,
      netPay: grossPay - total,
      note: '초단시간 근로자 (4대보험 면제)',
    };
  }

  // 4대보험 적용 파트타이머 — 정규직과 동일 로직 사용
  const full = calcRegularPayroll({ baseSalary: grossPay });
  return {
    grossPay,
    incomeTax: full.incomeTax,
    localIncomeTax: full.localIncomeTax,
    totalDeduction: full.totalDeduction,
    netPay: full.netPay,
    note: '파트타임 (4대보험 적용)',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 통합 디스패처 — 고용형태별로 올바른 계산기를 호출
// ─────────────────────────────────────────────────────────────────────────────

export type EmploymentType = 'regular' | 'freelancer' | 'parttime';

export interface UnifiedPayrollArgs {
  employmentType: EmploymentType;
  profile?: RegularPayrollProfile;
  inputs?: RegularPayrollInputs;
  freelancerGross?: number;
  partTime?: PartTimePayrollInput;
}

export type UnifiedPayrollResult =
  | ({ employmentType: 'regular' } & RegularPayrollResult)
  | ({ employmentType: 'freelancer' } & FreelancerPayrollResult)
  | ({ employmentType: 'parttime' } & PartTimePayrollResult);

export function calcPayroll(args: UnifiedPayrollArgs): UnifiedPayrollResult {
  if (args.employmentType === 'regular') {
    if (!args.profile) throw new Error('profile is required for regular payroll');
    return { employmentType: 'regular', ...calcRegularPayroll(args.profile, args.inputs) };
  }
  if (args.employmentType === 'freelancer') {
    return {
      employmentType: 'freelancer',
      ...calcFreelancerPayroll(args.freelancerGross ?? 0),
    };
  }
  if (args.employmentType === 'parttime') {
    if (!args.partTime) throw new Error('partTime input is required for parttime payroll');
    return { employmentType: 'parttime', ...calcPartTimePayroll(args.partTime) };
  }
  throw new Error(`unknown employmentType: ${args.employmentType as string}`);
}
