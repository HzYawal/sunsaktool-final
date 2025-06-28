# ========================================================
#  Playwright를 사용하는 최종 안정화 Dockerfile
# ========================================================

# 1. Playwright 공식 이미지를 사용 (모든 의존성 및 브라우저가 설치되어 있음)
FROM mcr.microsoft.com/playwright:v1.44.1-jammy

# 2. FFmpeg 및 한글 폰트만 추가로 설치
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    fonts-noto-cjk \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 3. 작업 디렉토리 설정
WORKDIR /app

# 4. 프로젝트 파일 복사
COPY . .

# 5. npm install 실행
RUN npm install --only=production

# 6. 애플리케이션 포트 노출
EXPOSE 3000

# 7. 컨테이너 시작 명령어
CMD ["node", "worker.js"]
