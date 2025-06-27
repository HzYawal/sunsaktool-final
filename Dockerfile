# 1. 베이스 이미지를 slim 버전이 아닌 full 버전으로 변경하여,
#    라이브러리 설치에 필요한 기본 도구들을 포함시킵니다.
FROM node:18

# 2. 시스템 패키지 목록을 업데이트하고, Puppeteer와 FFmpeg에 필요한 모든 라이브러리를 설치합니다.
#    기존에 있던 ffmpeg, fonts-noto-cjk에 Puppeteer 필수 라이브러리들을 모두 추가합니다.
RUN apt-get update && apt-get install -y --no-install-recommends \
    # --- FFmpeg & Fonts (기존에 있던 것) ---
    ffmpeg \
    fonts-noto-cjk \
    # --- Puppeteer 필수 라이브R러리 (새로 추가) ---
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    xdg-utils \
    libnss3 \
    # ------------------------------------
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 3. 작업 디렉토리 생성 및 지정
WORKDIR /app

# 4. package.json과 package-lock.json을 먼저 복사
COPY package*.json ./

# 5. 프로덕션용 라이브러리만 설치하여 이미지 크기 최적화
#    puppeteer는 개발용이 아닌 실제 사용 라이브러리이므로 --omit=dev는 제거하는 것이 안전합니다.
RUN npm install

# 6. 프로젝트의 모든 나머지 파일 복사
COPY . .

# 7. Railway가 외부 트래픽을 이 포트로 전달하도록 함 (기존과 동일)
EXPOSE 3000

CMD ["node", "worker.js"]

