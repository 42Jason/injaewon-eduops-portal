#!/usr/bin/env node
/**
 * EduOps Portal — seed demo data.
 *
 * Depends on init-db.js having been run first (or the same DB path existing).
 * All demo users share the password "demo1234" (bcrypt hashed).
 *
 * Usage:
 *   node scripts/seed.js
 *   node scripts/seed.js --db=... --password=...
 */

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const args = process.argv.slice(2);
const dbFlag = args.find((a) => a.startsWith('--db='));
const pwFlag = args.find((a) => a.startsWith('--password='));

const dbPath =
  (dbFlag && dbFlag.slice('--db='.length)) ||
  process.env.DB_PATH ||
  path.join(__dirname, '..', 'db', 'eduops.db');

const password = (pwFlag && pwFlag.slice('--password='.length)) || 'demo1234';

if (!fs.existsSync(dbPath)) {
  console.error(`[seed] DB not found at ${dbPath}. Run: node scripts/init-db.js`);
  process.exit(1);
}

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

const DEPARTMENTS = [
  [1, '경영'],
  [2, '운영'],
  [3, '행정/인사'],
  [4, '파싱팀'],
  [5, 'QA'],
  [6, 'CS'],
];

const USERS = [
  { id: 1,  email: 'ceo@eduops.kr',     name: '김대표', role: 'CEO',         dept: 1, title: '대표이사'   },
  { id: 2,  email: 'cto@eduops.kr',     name: '이기술', role: 'CTO',         dept: 1, title: 'CTO'        },
  { id: 3,  email: 'ops@eduops.kr',     name: '박운영', role: 'OPS_MANAGER', dept: 2, title: '운영매니저' },
  { id: 4,  email: 'hr@eduops.kr',      name: '최인사', role: 'HR_ADMIN',    dept: 3, title: '인사담당'   },
  { id: 5,  email: 'parser1@eduops.kr', name: '정파싱', role: 'PARSER',      dept: 4, title: '파싱팀장'   },
  { id: 6,  email: 'parser2@eduops.kr', name: '오미연', role: 'PARSER',      dept: 4, title: '파싱원'     },
  { id: 7,  email: 'qa1@eduops.kr',     name: '강QA1',  role: 'QA1',         dept: 5, title: '1차 QA'     },
  { id: 8,  email: 'qafinal@eduops.kr', name: '윤최종', role: 'QA_FINAL',    dept: 5, title: '최종 QA'    },
  { id: 9,  email: 'cs@eduops.kr',      name: '장CS',   role: 'CS',          dept: 6, title: 'CS 매니저'  },
  { id: 10, email: 'staff@eduops.kr',   name: '한직원', role: 'STAFF',       dept: 2, title: '주임'       },
];

const hash = bcrypt.hashSync(password, 10);

const insertDept = db.prepare(
  'INSERT OR IGNORE INTO departments (id, name) VALUES (?, ?)',
);
const insertUser = db.prepare(
  `INSERT OR IGNORE INTO users (id, email, password_hash, name, role, department_id, title, active)
   VALUES (@id, @email, @hash, @name, @role, @dept, @title, 1)`,
);
const insertSetting = db.prepare(
  `INSERT OR REPLACE INTO admin_settings (key, value_json, updated_at)
   VALUES (?, ?, datetime('now'))`,
);

const tx = db.transaction(() => {
  for (const [id, name] of DEPARTMENTS) insertDept.run(id, name);
  for (const u of USERS) insertUser.run({ ...u, hash });
  insertSetting.run('sla.parsing_hours', JSON.stringify(24));
  insertSetting.run('sla.qa1_hours', JSON.stringify(12));
  insertSetting.run('sla.qa_final_hours', JSON.stringify(12));
  insertSetting.run('brand.name', JSON.stringify('EduOps'));
});
tx();

const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
const deptCount = db.prepare('SELECT COUNT(*) AS n FROM departments').get().n;

console.log(`[seed] OK — ${dbPath}`);
console.log(`[seed] departments=${deptCount}, users=${userCount}`);
console.log(`[seed] default password for all demo users: "${password}"`);

db.close();
