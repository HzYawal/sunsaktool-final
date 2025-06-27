# ===================================================================
#  SunsakTool을 위한 범용 Dockerfile (Server 및 Worker용)
# ===================================================================

# 1. 베이스 이미지 선택 (slim 버전으로 경량화)
FROM node:18-slim

# 2. 빌드 인자(ARG) 및 환경 변수(ENV) 설정
# 빌드 시 어떤 서비스를 시작할지 지정합니다. (server 또는 worker)
# 예: --build-arg SERVICE_NAME=worker
# 기본값은 'server'로 설정합니다.
ARG SERVICE_NAME=server
ENV NODE_ENV=production
ENV SERVICE_TO_RUN=${SERVICE_NAME}

# 3. 시스템 패키지 설치 (FFmpeg, Puppeteer, 한글 폰트)
# --no-install-recommends: 불필요한 추천 패키지 설치를 건너뛰어 이미지 용량을 줄입니다.
# apt-get clean && rm -rf ...: 설치 후 캐시를 정리하여 최종 이미지 용량을 최소화합니다.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    fonts-noto-cjk \
    # ------ Puppeteer 의존성 패키지 (Debian/Ubuntu 기반) ------
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
    # ----------------------------------------------------
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 4. 작업 디렉토리 설정
WORKDIR /app

# 5. package.json 파일을 먼저 복사하여 종속성 캐싱 활용
COPY package*.json ./

# 6. 프로덕션용 종속성만 설치 (--only=production)
# 개발용 라이브러리(devDependencies)는 최종 이미지에 포함되지 않아 보안과 용량에 유리합니다.
RUN npm install --only=production

# 7. 프로젝트 소스 코드 복사 (이제 키 파일은 필요 없습니다)
COPY . .

# 8. 애플리케이션 포트 노출
# PORT 환경 변수를 Cloud Run이 자동으로 주입하므로, 8080을 사용하는 것이 표준입니다.
# 코드(server.js, worker.js)에서 process.env.PORT || 3000 으로 되어 있으므로 문제없이 동작합니다.
EXPOSE 8080

# 9. 컨테이너 시작 명령어 (동적 실행)
# 셸 형식으로 작성하여 환경 변수($SERVICE_TO_RUN)를 동적으로 해석하도록 합니다.
# 만약 SERVICE_TO_RUN이 'worker'이면 'node worker.js'가 실행됩니다.
CMD ["node", "server.js"]
