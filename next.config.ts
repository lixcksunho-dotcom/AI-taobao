import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // instrumentation.ts 는 Next.js 15+에서 기본 활성화
  // 홈 디렉터리(C:\Users\선호)에 package-lock.json이 있어 Next가 워크스페이스 루트를
  // 부모로 오인식 → 모듈 해석/파일 트레이싱 루트를 이 프로젝트로 고정
  turbopack: {
    root: __dirname,
  },
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
