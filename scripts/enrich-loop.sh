#!/usr/bin/env bash
# 타오바오 enrich 무인완주 오케스트레이터
# 패스마다 --all --slow 실행 → 남은개수 확인 → 진행되면 짧은쿨다운, 막히면 긴쿨다운.
# 남은개수 0까지 또는 최대 12회까지 반복. 모든 출력은 호출측 로그로.
set -u
cd "$(dirname "$0")/.." || exit 1

remaining() { node scripts/enrich-taobao.mjs --count 2>/dev/null | tail -1; }

prev=$(remaining); prev=${prev:-99}
echo "### LOOP START $(date) — 미보강 ${prev}개"

# 세션이 막 차단된 직후라 첫 패스 전 쿨다운(30분)
echo "### 초기 쿨다운 1800s $(date)"
sleep 1800

for attempt in $(seq 1 12); do
  echo ""
  echo "### ATTEMPT ${attempt} $(date) — 남은 ${prev}개"
  node scripts/enrich-taobao.mjs --all 999 --slow
  cur=$(remaining); cur=${cur:-$prev}
  echo "### attempt ${attempt} 종료 — 남은 ${cur}개 (이전 ${prev})"

  if [ "$cur" -le 0 ] 2>/dev/null; then echo "### ✅ ALL DONE $(date)"; break; fi

  if [ "$cur" -lt "$prev" ] 2>/dev/null; then
    echo "### 진행됨(${prev}→${cur}) — 짧은 쿨다운 600s"
    sleep 600
  else
    echo "### 막힘(진행 0) — 긴 쿨다운 1800s"
    sleep 1800
  fi
  prev=$cur
done

echo "### LOOP END $(date) — 최종 남은 $(remaining)개"
