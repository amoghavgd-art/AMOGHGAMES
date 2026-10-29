/// <reference types="vite/client" />

import type { ArcadeStage, BenchResult } from "./stage/ArcadeStage";
import type { CheckResult } from "./selftest/SelfTest";

declare module "*?raw" {
  const src: string;
  export default src;
}

declare global {
  interface Window {
    __ARCADE_STAGE__?: ArcadeStage;
    __PLAYGLOW_STAGE__?: ArcadeStage;
    __STAGE__?: ArcadeStage;
    __BENCH_RESULT__?: BenchResult;
    __BENCH_RUNNING__?: boolean;
    __SELFTEST_RESULTS__?: CheckResult[];
  }
}
