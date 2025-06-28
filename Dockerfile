# ========================================================
#  Playwright를 사용하는 최종 안정화 Dockerfile (2세대 호환)
# ========================================================

# 1. Playwright 공식 이미지를 사용합니다.
FROM mcr.microsoft.com/playwright:v1.44.1-jammy

# 2. [최종 수정] 2세대 환경과의 호환성을 위한 필수 라이브러리 및 한글 폰트를 추가로 설치합니다.
#    이 라이브러리들은 브라우저가 정상적으로 그래픽을 처리하고 실행되는 데 필요합니다.
RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-noto-cjk \
    libnss3 \
    libxss1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libatspi2.0-0 \
    libgbm-dev \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 3. 작업 디렉토리 설정
WORKDIR /app

# 4. 의존성 설치 최적화를 위해 package.json 파일부터 복사
COPY package*.json ./
RUN npm install --only=production

# 5. 나머지 프로젝트 파일들을 복사
COPY . .

# 6. 포트 노출
EXPOSE 3000

# 7. 기본 시작 명령어
CMD ["node", "worker.js"]
