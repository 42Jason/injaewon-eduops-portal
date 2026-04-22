import { contextBridge } from 'electron';
import { coreApi } from './preload/core';
import { adminApi } from './preload/admin';
export type { UpdaterStatusPayload } from './preload/types';

const api = {
  ...coreApi,
  ...adminApi,
};

contextBridge.exposeInMainWorld('api', api);

export type EduOpsApi = typeof api;
