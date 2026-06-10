# -*- coding: utf-8 -*-
"""
이미지 속 중국어 → 한국어 자연 번역 렌더링 (로컬 OCR/inpaint + Haiku 번역)
v2: 글자 자동맞춤(줄바꿈+축소) · 뱃지 배경 보존 · 글자색 매칭 · OCR 업스케일

사용법: python scripts/translate_image.py <입력> <출력> [--cache <json>]
"""
import sys, os, json, re, urllib.request, argparse
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont
from rapidocr_onnxruntime import RapidOCR

# Windows 콘솔(cp949)에서 한글/중국어 print 시 UnicodeEncodeError로 죽는 것 방지
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

FONT_PATH = r"C:\Windows\Fonts\malgun.ttf"
FONT_BOLD = r"C:\Windows\Fonts\malgunbd.ttf"
CONF_MIN = 0.5
MIN_SIDE = 600      # 짧은 변 600px 미만 = 저화질/아이콘/변형썸네일 → 제외 (고화질만 유지)
MIN_BYTES = 5000    # 5KB 미만 = 빈/손상 → 제외
# 공급처 워터마크/회사명/연락처/AI생성마크 — 번역·잔존이 아니라 '제거'(inpaint) 대상
WATERMARK_RE = re.compile(
    r"有限公司|公司|旗舰店|专卖店|商行|商贸|批发|工厂|厂家|服饰|服装|制衣|"
    r"微信|抖音|快手|淘宝|阿里|天猫|拼多多|版权|侵权必究|"
    r"AI生成|AI制图|豆包|即梦|文心|通义|可灵|美图|"
    r"\bVX\b|\bvx\b|www\.|https?://|\.com|\.cn|\.net|@", re.I)

# 색상/사이즈어(반복돼도 워터마크로 오인하면 안 됨)
_CN_COLORS = ("卡其", "杏色", "浅蓝", "浅绿", "蓝绿", "藏青", "墨绿", "驼色", "米白", "米色",
              "酒红", "豆绿", "雾霾蓝", "克莱因蓝", "焦糖", "奶杏", "燕麦")
_SIZE_RE = re.compile(r"[码尺]|均码|XS|XL|XXL|XXXL|\bS\b|\bM\b|\bL\b")

# 정상 영문 디자인 텍스트(워터마크 아님) — 라틴 반복글자 오제거 방지
_EN_STOP = {"summer", "winter", "spring", "autumn", "fall", "new", "in", "ootd", "detail",
            "details", "style", "fashion", "color", "colour", "size", "sale", "hot", "fabric",
            "material", "design", "show", "display", "model", "vol", "the", "of", "and", "for"}

def is_brandlike(t):
    """짧은 브랜드/워터마크성 글자인가(색상·사이즈·숫자·정상영문 제외) — 교차이미지 반복 탐지용"""
    s = t.strip()
    chars = re.findall(r"[一-鿿]", s)
    if chars:   # 중국어 후보
        if not (2 <= len(chars) <= 6):
            return False
        if _SIZE_RE.search(s) or re.search(r"\d", s):
            return False
        if s.endswith("色") or any(c in s for c in _CN_COLORS):
            return False
        return True
    # 라틴 후보: 짧은 영문 1~2단어, 숫자·불용어 제외(브랜드명 'Fei Yun' 등)
    letters = re.sub(r"[^A-Za-z]", "", s)
    if not (3 <= len(letters) <= 12) or re.search(r"\d", s):
        return False
    words = [w for w in re.split(r"\s+", s) if w]
    if len(words) > 2 or any(w.lower() in _EN_STOP for w in words):
        return False
    return True

_ocr = None

def get_ocr():
    global _ocr
    if _ocr is None:
        _ocr = RapidOCR()
    return _ocr

def load_env():
    env = {}
    p = os.path.join(os.path.dirname(__file__), "..", ".env.local")
    with open(p, encoding="utf-8") as f:
        for line in f:
            m = re.match(r"^([^#=]+)=(.*)$", line)
            if m:
                env[m.group(1).strip()] = m.group(2).strip()
    return env

def has_chinese(s):
    return bool(re.search(r"[一-鿿]", s))

_TRANSLATE_RULES = (
    "다음은 중국 쇼핑몰(타오바오/1688) 상품 이미지에 박힌 문구들이다. "
    "한국 쇼핑몰 상세페이지에 실제로 쓸 법한 자연스럽고 간결한 한국어로 번역해라.\n"
    "규칙:\n"
    "- 의류/잡화 패션 용어로. 예) 纯欲→청순섹시, 聚拢美胸→가슴 모아주는, 显瘦→슬림해보이는, "
    "免穿文胸→노브라 가능, 防走光→비침 방지, 内置胸垫→패드 내장, 收腰→허리 잘록, "
    "莫代尔→모달, 莱赛尔→텐셀, 高弹→신축성, 滑爽→부드럽고 산뜻한.\n"
    "- 색상명은 한국 쇼핑몰 표기로 '짧게 한 단어'(예: 浅蓝→연블루, 卡其→카키, 杏色→아이보리, 蓝绿→민트, 浅绿→연그린, 黑色→블랙, 粉色→핑크). 길게 풀어쓰지 말 것.\n"
    "- 사이즈/숫자는 그대로. 원문보다 길지 않게, 짧고 매력적으로.\n"
    "- 브랜드명 직역 금지. OCR 오인식으로 글자가 깨졌으면 문맥상 가장 그럴듯한 패션 문구로 보정.\n"
    "- 한국어로 의미없는 음역(예: '순욕')은 쓰지 말 것. 한자를 그대로 두지 말고 반드시 한국어로.\n"
    "- OCR 오인식으로 깨진 의미불명 문자열(예: '米苏42巴斯元342'), 또는 매장명·간판·배경 글자 등 "
    "상품과 무관해 번역이 불필요/불가하면 그 항목은 빈 문자열(\"\")로 둘 것. 억지 음역 금지.\n"
    "- 의미가 통하는 상품 문구는 모두 빠짐없이 번역. 번역 결과에 한자가 남으면 안 됨.\n"
)

def _api_translate(todo, api_key):
    """todo 리스트를 번호키 JSON으로 번역 → todo와 같은 순서의 결과 리스트(실패=None)"""
    listing = "\n".join(f"{i+1}. {t}" for i, t in enumerate(todo))
    prompt = (_TRANSLATE_RULES +
              "\n반드시 '번호'를 키로 하는 JSON으로만 응답: "
              "{\"1\":\"번역1\", \"2\":\"번역2\", ...}. 모든 번호 포함.\n\n" + listing)
    body = json.dumps({
        "model": "claude-haiku-4-5-20251001", "max_tokens": 2048,
        "messages": [{"role": "user", "content": prompt}],
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages", data=body,
        headers={"content-type": "application/json", "x-api-key": api_key,
                 "anthropic-version": "2023-06-01"})
    out = [None] * len(todo)
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            resp = json.loads(r.read())
        text = resp["content"][0]["text"]
        j = re.search(r"\{[\s\S]*\}", text)
        parsed = json.loads(j.group(0)) if j else {}
    except Exception as e:
        print(f"  번역 API 오류: {str(e)[:60]}")
        return out
    for k, v in parsed.items():
        m = re.match(r"\s*(\d+)", str(k))
        if not m or not v:
            continue
        idx = int(m.group(1)) - 1
        val = str(v).strip()
        # 번호 기준 매핑(키 불일치 방지) + 한자 잔존 결과는 실패 처리
        if 0 <= idx < len(todo) and val and not has_chinese(val):
            out[idx] = val
    return out

def translate_batch(texts, api_key, cache=None):
    """원문→번역 dict 반환. 번역 실패 시 값은 None(원문 중국어를 절대 그대로 쓰지 않음)."""
    cache = cache if cache is not None else {}
    todo = [t for t in texts if t not in cache]
    if todo:
        res = _api_translate(todo, api_key)
        for t, r in zip(todo, res):
            if r is not None:
                cache[t] = r
        # 실패건만 한 번 더 개별 재시도
        failed = [t for t, r in zip(todo, res) if r is None]
        if failed:
            res2 = _api_translate(failed, api_key)
            for t, r in zip(failed, res2):
                if r is not None:
                    cache[t] = r
    return {t: cache.get(t) for t in texts}

def quad_bbox(box):
    xs = [p[0] for p in box]; ys = [p[1] for p in box]
    return int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys))

def _overlap_ratio(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    amin = min((a[2]-a[0])*(a[3]-a[1]), (b[2]-b[0])*(b[3]-b[1]))
    return inter / max(1, amin)

def refine_items(items):
    """배경 잡텍스트(서로 심하게 겹치는 박스 무더기) 드롭 + 세로 적층 콜아웃 병합"""
    n = len(items)
    if n <= 1:
        return items
    boxes = [(it[0], it[1], it[2], it[3]) for it in items]
    # A) 상호 35%↑ 겹치는 박스는 배경 잡음으로 보고 모두 드롭
    drop = set()
    for i in range(n):
        for j in range(i + 1, n):
            if _overlap_ratio(boxes[i], boxes[j]) > 0.35:
                drop.add(i); drop.add(j)
    kept = [items[i] for i in range(n) if i not in drop]
    # B) 세로로 가깝게 적층된(같은 x대역) 박스 병합 → 한 문구로
    kept.sort(key=lambda it: it[1])
    used = [False] * len(kept)
    merged = []
    for i in range(len(kept)):
        if used[i]:
            continue
        x0, y0, x1, y1, txt = kept[i]
        used[i] = True
        for j in range(i + 1, len(kept)):
            if used[j]:
                continue
            X0, Y0, X1, Y1, T = kept[j]
            ix = max(0, min(x1, X1) - max(x0, X0))
            xr = ix / max(1, min(x1 - x0, X1 - X0))
            h = max(y1 - y0, Y1 - Y0)
            gap = Y0 - y1
            if xr > 0.5 and -0.3 * h <= gap <= 0.6 * h:   # x 겹치고 세로로 인접
                x0, y0, x1, y1 = min(x0, X0), min(y0, Y0), max(x1, X1), max(y1, Y1)
                txt = txt + T
                used[j] = True
        merged.append((x0, y0, x1, y1, txt))
    return merged

def bg_and_text_color(region_bgr):
    """박스 영역에서 배경색(테두리 다수색)과 글자색(배경과 먼 색) 추정"""
    h, w = region_bgr.shape[:2]
    if h < 2 or w < 2:
        return (255, 255, 255), (20, 20, 20), 0.0
    border = np.concatenate([
        region_bgr[0, :].reshape(-1, 3), region_bgr[-1, :].reshape(-1, 3),
        region_bgr[:, 0].reshape(-1, 3), region_bgr[:, -1].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    flat = region_bgr.reshape(-1, 3).astype(np.float32)
    dist = np.linalg.norm(flat - bg, axis=1)
    var = float(np.var(border.astype(np.float32)))   # 배경 균일도
    fg_pixels = flat[dist > 60]
    fg = np.median(fg_pixels, axis=0) if len(fg_pixels) > 5 else np.array([20, 20, 20])
    return tuple(int(x) for x in bg), tuple(int(x) for x in fg), var

def wrap_fit(text, w, h, bold=False):
    """박스(w,h)에 맞게 줄바꿈+폰트크기 자동 결정 → (font, lines)"""
    path = FONT_BOLD if (bold and os.path.exists(FONT_BOLD)) else FONT_PATH
    for size in range(max(14, int(h * 0.95)), 9, -2):
        font = ImageFont.truetype(path, size)
        # 한국어는 글자단위 줄바꿈 (공백 우선)
        words = text.split(' ')
        lines, cur = [], ''
        def width(s): return font.getbbox(s)[2]
        for word in words:
            cand = (cur + ' ' + word).strip()
            if width(cand) <= w * 1.02 or not cur:
                # 단어 자체가 길면 글자단위로 쪼갬
                if width(cand) > w * 1.02 and not cur:
                    tmp = ''
                    for ch in cand:
                        if width(tmp + ch) > w * 1.02 and tmp:
                            lines.append(tmp); tmp = ch
                        else:
                            tmp += ch
                    cur = tmp
                else:
                    cur = cand
            else:
                lines.append(cur); cur = word
        if cur:
            lines.append(cur)
        line_h = font.getbbox("가")[3] + 4
        if line_h * len(lines) <= h * 1.15 and all(width(l) <= w * 1.05 for l in lines):
            return font, lines
    font = ImageFont.truetype(path, 11)
    return font, [text]

def extract_all_items(img):
    """이미지에서 모든 OCR 항목(중국어+라틴) 추출 → [(x0,y0,x1,y1,text)] (원본 좌표)"""
    H, W = img.shape[:2]
    scale = 2.0 if max(H, W) < 1100 else 1.0
    ocr_img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC) if scale != 1 else img
    res, _ = get_ocr()(ocr_img)
    items = []
    for box, text, conf in (res or []):
        if float(conf) >= CONF_MIN and (text or "").strip():
            x0, y0, x1, y1 = quad_bbox(box)
            items.append((int(x0/scale), int(y0/scale), int(x1/scale), int(y1/scale), text))
    return items

def process_one(src, dst, env, cache, raw=False, smart=False, all_items=None, dynamic_wm=None):
    # 품질 필터: 디코드 불가/너무 작음/저용량 = 불필요(아이콘·뱃지·손상) → 제외(출력 안 함)
    img = cv2.imdecode(np.fromfile(src, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        print(f"제외(디코드불가): {os.path.basename(src)}")
        return -1
    H, W = img.shape[:2]
    try:
        nbytes = os.path.getsize(src)
    except OSError:
        nbytes = MIN_BYTES
    if min(W, H) < MIN_SIDE or nbytes < MIN_BYTES:
        print(f"제외(저품질 {W}x{H} {nbytes//1024}KB): {os.path.basename(src)}")
        return -1
    if raw:
        # 번역 없이 원본 그대로(품질필터만 적용)
        cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 92])[1].tofile(dst)
        return 0

    # OCR (사전 탐지에서 받은 결과 있으면 재사용, 없으면 직접). all = 중국어+라틴 전체
    allit = all_items if all_items is not None else extract_all_items(img)
    dyn = dynamic_wm or set()
    def _is_wm(t):
        return bool(WATERMARK_RE.search(t)) or (t.strip() in dyn)

    # 워터마크(스크립트 무관: 회사명/URL/교차반복 브랜드마크) → 제거
    watermarks = [it for it in allit if _is_wm(it[4])]
    # 워터마크에 인접한 '라틴' 텍스트도 같은 워터마크의 로마자 표기로 보고 제거
    # (예: 菲韵 옆 'Fei Yun' — OCR이 매번 다르게 읽혀 반복탐지가 안 되므로 위치로 처리). 한자 콜아웃은 보호
    wm_ids = {id(w) for w in watermarks}
    extra = []
    for w in watermarks:
        ww, hh = max(1, w[2]-w[0]), max(1, w[3]-w[1])
        ax0, ay0 = w[0]-int(0.4*ww), w[1]-int(1.4*hh)
        ax1, ay1 = w[2]+int(0.4*ww), w[3]+int(1.4*hh)
        for b in allit:
            if id(b) in wm_ids or id(b) in {id(e) for e in extra} or has_chinese(b[4]):
                continue
            if not (b[2] < ax0 or b[0] > ax1 or b[3] < ay0 or b[1] > ay1):
                extra.append(b)
    watermarks = watermarks + extra
    wm_texts = {it[4] for it in watermarks}
    # 번역 대상은 중국어 항목 중 워터마크 아닌 것
    cn_only = [it for it in allit if has_chinese(it[4]) and it[4] not in wm_texts and not _is_wm(it[4])]
    before = len(cn_only)
    items = refine_items(cn_only)

    inpaint_mask = np.zeros((H, W), np.uint8)
    for x0, y0, x1, y1, _cn in watermarks:
        # 박스 전체를 칠하면 배경까지 뭉개져 얼룩 → 반투명 '글자 획'만 정밀 마스킹
        bx0, by0 = max(0, x0-4), max(0, y0-4)
        bx1, by1 = min(W, x1+4), min(H, y1+4)
        reg = img[by0:by1, bx0:bx1]
        if reg.size == 0:
            continue
        g = cv2.cvtColor(reg, cv2.COLOR_BGR2GRAY)
        sigma = max(3.0, (by1 - by0) / 3.0)
        bgest = cv2.GaussianBlur(g, (0, 0), sigmaX=sigma)   # 저주파=배경 추정
        diff = cv2.absdiff(g, bgest)                         # 고주파=글자 획
        _, m = cv2.threshold(diff, 14, 255, cv2.THRESH_BINARY)
        m = cv2.dilate(m, np.ones((3, 3), np.uint8), iterations=1)
        inpaint_mask[by0:by1, bx0:bx1] = np.maximum(inpaint_mask[by0:by1, bx0:bx1], m)
    if watermarks:
        print(f"워터마크 제거 {len(watermarks)}건: " + ", ".join(w[4][:16] for w in watermarks))

    # smart 모드: 색상/사이즈 옵션 차트(짧은 라벨 여러 개)만 번역, 그 외 글자는 번역 안 함(워터마크는 위에서 제거)
    if smart:
        short = [it for it in items if len(it[4]) <= 5]
        size_kw = any(re.search(r'[码尺]|size|S|M|L|XL', it[4], re.I) for it in items)
        is_chart = (len(items) >= 3 and len(short) >= 3) or (size_kw and len(items) >= 3)
        if not is_chart:
            items = []
    if items:
        print(f"중국어 검출: {before}건 → 정제 {len(items)}건{' [옵션차트]' if smart else ''}")

    uniq = list({t for *_, t in items})
    trans = translate_batch(uniq, env["ANTHROPIC_API_KEY"], cache) if uniq else {}
    for cn in uniq:
        print(f"  {cn} -> {trans.get(cn) or '(번역실패-원본유지)'}")

    # 번역 성공(한자 잔존 없음)한 박스만 처리. 실패 박스는 렌더 스킵 → 원본 그대로(두부/중국어 잔존 방지)
    items = [it for it in items if trans.get(it[4]) and not has_chinese(trans[it[4]])]

    # 번역할 것도, 제거할 워터마크도 없으면 원본 그대로 저장
    if not items and not inpaint_mask.any():
        cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 92])[1].tofile(dst)
        return 0

    # 채도 높은 단색 뱃지 → 색 채움 보존 / 그 외(옷·사진 위 글자) → inpaint 후 글자만 직접 렌더
    pad = 3
    fills = []   # (cx, cy, fg, lines, font, mode)
    # 각 항목 중심 (이웃 간격 계산용)
    ctrs = [((it[0]+it[2])//2, (it[1]+it[3])//2) for it in items]
    for ii, (x0, y0, x1, y1, cn) in enumerate(items):
        # 같은 행(비슷한 y)의 가장 가까운 이웃까지의 가로 거리 → 폭 상한
        mycx, mycy = ctrs[ii]
        myh = y1 - y0
        gaps = [abs(mycx - ox) for jj, (ox, oy) in enumerate(ctrs)
                if jj != ii and abs(oy - mycy) < myh * 1.6]
        ngap = min(gaps) if gaps else W
        cap_w = max(50, int(ngap * 0.92))   # 이웃과 안 겹치게
        x0, y0 = max(0, x0-pad), max(0, y0-pad)
        x1, y1 = min(W, x1+pad), min(H, y1+pad)
        region = img[y0:y1, x0:x1]
        bg, fg, var = bg_and_text_color(region)
        sat = max(bg) - min(bg)
        kr = trans[cn]   # 위에서 번역 성공한 항목만 남김
        w, h = x1 - x0, y1 - y0
        cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
        is_badge = var < 800 and sat > 45     # 빨강/색 뱃지 등 단색 배경
        if is_badge:
            cv2.rectangle(img, (x0, y0), (x1, y1), bg, -1)
            font, lines = wrap_fit(kr, int(w * 1.3), int(h * 2.2))
            fills.append((cx, cy, fg, lines, font, False, var))   # 단색 뱃지: 외곽선 불필요
        else:
            cv2.rectangle(inpaint_mask, (x0, y0), (x1, y1), 255, -1)
            # 세로로 쌓인 원문(높이>너비)은 글자너비 기준, 가로글은 높이 기준
            vertical = h > w * 1.3
            target = max(13, int(w * 0.85 if vertical else h * 0.82))
            maxw = min(int(W * 0.42), cap_w)   # 이웃 간격 넘지 않게
            font = ImageFont.truetype(FONT_PATH, target)
            if font.getbbox(kr)[2] <= maxw:
                lines = [kr]
            else:
                # 폭 안에 들도록 폰트 축소 우선, 그래도 길면 줄바꿈
                while target > 13 and ImageFont.truetype(FONT_PATH, target).getbbox(kr)[2] > maxw:
                    target -= 1
                font = ImageFont.truetype(FONT_PATH, target)
                if font.getbbox(kr)[2] <= maxw:
                    lines = [kr]
                else:
                    font, lines = wrap_fit(kr, maxw, target * 4)
            fills.append((cx, cy, fg, lines, font, True, var))    # 사진/옷 위 글자: 외곽선+캡션밴드
    if inpaint_mask.any():
        # 마스크를 살짝 키워 원문 가장자리 잔여까지 제거
        inpaint_mask = cv2.dilate(inpaint_mask, np.ones((3, 3), np.uint8), iterations=1)
        img = cv2.inpaint(img, inpaint_mask, 3, cv2.INPAINT_TELEA)

    pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(pil)
    for cx, cy, fg, lines, font, stroke, var in fills:
        color = (fg[2], fg[1], fg[0])   # BGR→RGB
        # 글자색 밝기에 따라 반대색 외곽선 → 흰배경 흰글자/검은배경 검은글자에도 또렷
        sw, scol = 0, None
        if stroke:
            lum = 0.299 * fg[2] + 0.587 * fg[1] + 0.114 * fg[0]
            scol = (40, 40, 40) if lum > 140 else (250, 250, 250)
            sw = max(2, font.size // 14)
        line_h = font.getbbox("가")[3] + 4 + sw
        total_h = line_h * len(lines)
        ty = int(min(max(cy - total_h / 2, 2), H - total_h - 2))
        for ln in lines:
            tw = font.getbbox(ln)[2]
            tx = int(min(max(cx - tw / 2, 2 + sw), W - tw - 2 - sw))
            draw.text((tx, ty), ln, font=font, fill=color,
                      stroke_width=sw, stroke_fill=scol)
            ty += line_h

    pil.save(dst, quality=92)
    return len(items)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src", help="이미지 파일 또는 --batch 시 입력 폴더")
    ap.add_argument("dst", help="출력 파일 또는 --batch 시 출력 폴더")
    ap.add_argument("--cache", default=None)
    ap.add_argument("--batch", action="store_true", help="src/dst를 폴더로 처리")
    ap.add_argument("--raw", action="store_true", help="번역 없이 품질필터만 적용(원본 유지)")
    ap.add_argument("--smart", action="store_true", help="색상/사이즈 옵션차트만 번역, 나머지 원본 유지")
    args = ap.parse_args()

    env = load_env()
    cache = {}
    if args.cache and os.path.exists(args.cache):
        cache = json.load(open(args.cache, encoding="utf-8"))

    if args.batch:
        import glob, shutil
        # 출력 폴더 초기화 (이전 실행의 옛/제외 파일 잔류 방지)
        if os.path.isdir(args.dst):
            shutil.rmtree(args.dst)
        os.makedirs(args.dst, exist_ok=True)
        files = sorted([f for f in glob.glob(os.path.join(args.src, "*"))
                        if re.search(r"\.(jpg|jpeg|png|webp)$", f, re.I)])
        print(f"배치: {len(files)}개")

        # 교차이미지 워터마크 사전 탐지: 폴더 전체 OCR → 여러 이미지에 반복되는
        # 짧은 브랜드성 글자(색상·사이즈·숫자 제외)를 동적 워터마크로 등록(OCR 결과는 캐시해 재사용)
        ocr_cache, counter = {}, {}
        dynamic_wm = set()
        if not args.raw and len(files) >= 2:
            for f in files:
                try:
                    img = cv2.imdecode(np.fromfile(f, dtype=np.uint8), cv2.IMREAD_COLOR)
                    if img is None or min(img.shape[:2]) < MIN_SIDE:
                        continue
                    its = extract_all_items(img)
                    ocr_cache[f] = its
                    for t in {it[4].strip() for it in its}:
                        if is_brandlike(t):
                            counter[t] = counter.get(t, 0) + 1
                except Exception:
                    pass
            dynamic_wm = {t for t, c in counter.items() if c >= 2}
            if dynamic_wm:
                print(f"교차이미지 워터마크 감지: {', '.join(sorted(dynamic_wm))}")

        total, dropped, kept = 0, 0, 0
        for f in files:
            name = os.path.splitext(os.path.basename(f))[0] + ".jpg"
            out = os.path.join(args.dst, name)
            try:
                n = process_one(f, out, env, cache, raw=args.raw, smart=args.smart,
                                 all_items=ocr_cache.get(f), dynamic_wm=dynamic_wm)
                if n < 0:
                    dropped += 1
                else:
                    kept += 1; total += n
            except Exception as e:
                print(f"  {os.path.basename(f)}: 오류 {str(e)[:50]}")
        print(f"완료: 유지 {kept}장 · 제외 {dropped}장 · 번역 {total}건")
    else:
        n = process_one(args.src, args.dst, env, cache, raw=args.raw, smart=args.smart)
        print(f"저장: {args.dst} (중국어 {n}건)")

    if args.cache:
        json.dump(cache, open(args.cache, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

if __name__ == "__main__":
    main()
