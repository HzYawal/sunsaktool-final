# 1. 베이스 이미지
FROM node:18

# 2. 시스템 패키지 설치 (FFmpeg, Puppeteer 의존성)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    fonts-noto-cjk \
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
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 3. 작업 디렉토리 설정
WORKDIR /app

# 4. package.json 파일을 먼저 복사 (캐시 효율을 위해)
COPY package*.json ./

# 5. npm 라이브러리 설치
RUN npm install

# 6. [가장 중요!] 프로젝트의 모든 파일 (sunsak-key.json 포함)을 복사
COPY . .

# 7. 포트 설정
EXPOSE 3000

# 8. 서버 시작 명령어 (배포 시점에 server.js 또는 worker.js로 변경)
# 8. 서버 시작 명령어
CMD ["node", "worker.js"]
