# ========================================================
#  Playwright를 사용하는 최종 안정화 Dockerfile (수정 버전)
# ========================================================

# 1. Playwright 공식 이미지를 사용 (모든 의존성 및 브라우저가 설치되어 있음)
FROM mcr.microsoft.com/playwright:v1.44.1-jammy

# 2. [수정] FFmpeg 설치를 제거하고, 한글 폰트만 추가로 설치합니다.
#    Playwright 기본 이미지에 이미 필요한 FFMPEG 라이브러리가 포함되어 있습니다.
RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-noto-cjk \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 3. 작업 디렉토리 설정
WORKDIR /app

# 4. [최적화] package.json 파일을 먼저 복사하여 의존성 설치부터 진행
COPY package*.json ./
RUN npm install --only=production

# 5. [최적화] 나머지 프로젝트 파일들을 복사
COPY . .

# 6. 애플리케이션 포트 노출 (워커에서는 사용되지 않지만, API 서버와 이미지를 공유하므로 유지)
EXPOSE 3000

# 7. 컨테이너 시작 명령어 (gcloud deploy 명령어에서 덮어쓰므로 기본값 역할)
CMD ["node", "worker.js"]
