# ========================================================
#  SunsakTool Worker를 위한 최종 안정화 Dockerfile (Chrome 설치 버전)
# ========================================================

# 1. 베이스 이미지
FROM node:18

# 2. 환경 변수 설정
ENV NODE_ENV=production
# [핵심] Puppeteer가 시스템에 설치된 Chrome을 사용하도록 강제
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# 3. 시스템 패키지 설치 (FFmpeg, Puppeteer 의존성 및 정식 Chrome 설치)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    fonts-noto-cjk \
    # Chrome 설치에 필요한 패키지들
    ca-certificates \
    curl \
    gnupg \
    # Puppeteer 실행에 필요한 최소한의 라이브러리
    libasound2 \
    libdbus-1-3 \
    libnspr4 \
    libxss1 \
    libxtst6 \
    # Google Chrome 공식 저장소 추가 및 설치
    && curl -sS -o - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    # 설치 후 정리
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && rm /etc/apt/sources.list.d/google-chrome.list

# 4. 작업 디렉토리 설정
WORKDIR /app

# 5. package.json 파일들 복사
COPY package*.json ./

# 6. 프로덕션용 종속성만 설치
# 이제 Chromium을 다운로드하지 않으므로 매우 빨라짐
RUN npm install --only=production

# 7. 프로젝트 소스 코드 복사
COPY . .

# 8. 애플리케이션 포트 노출
EXPOSE 3000

# 9. 컨테이너 시작 명령어
CMD ["node", "worker.js"]
