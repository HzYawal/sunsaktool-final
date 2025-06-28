# ========================================================
#  SunsakTool Worker를 위한 최종 안정화 Dockerfile
# ========================================================

# 1. 베이스 이미지 (안정성을 위해 Full 버전 사용)
FROM node:18

# 2. 환경 변수 설정
ENV NODE_ENV=production

# 3. 시스템 패키지 설치 (FFmpeg, Puppeteer, 한글 폰트 및 추가 의존성)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    fonts-noto-cjk \
    # ------ Puppeteer 의존성 패키지 (모든 가능성 포함) ------
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libgconf-2-4 \
    libgdk-pixbuf2.0-0 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
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
    # ----------------------------------------------------
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 4. 작업 디렉토리 설정
WORKDIR /app

# 5. package.json 파일을 먼저 복사하여 종속성 캐싱 활용
COPY package*.json ./

# 6. 프로덕션용 종속성만 설치
RUN npm install --only=production

# 7. 프로젝트 소스 코드 복사
COPY . .

# 8. (디버깅용) 파일이 잘 복사되었는지 확인하는 단계
RUN echo "===== 파일 목록 확인 =====" && \
    ls -la /app && \
    echo "========================"

# 9. 애플리케이션 포트 노출
EXPOSE 8080

# 10. 컨테이너 시작 명령어 (Worker용으로 고정)
CMD ["node", "worker.js"]
