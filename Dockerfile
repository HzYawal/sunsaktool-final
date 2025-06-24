# 1. 베이스 이미지 선택 (Node.js 18 버전, slim은 가벼운 버전)
FROM node:18-slim

# 2. 시스템 패키지 업데이트 및 FFmpeg, 한국어 폰트 관련 라이브러리 설치
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    fonts-noto-cjk \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 3. 작업 디렉토리 생성 및 지정
WORKDIR /app

# 4. package.json과 package-lock.json을 먼저 복사
COPY package*.json ./

# 5. 프로덕션용 라이브러리만 설치하여 이미지 크기 최적화
RUN npm install --omit=dev

# 6. 프로젝트의 모든 나머지 파일 복사
COPY . .

# 7. Railway가 외부 트래픽을 이 포트로 전달하도록 함
EXPOSE 3000

# 8. 서버 시작 명령어
CMD [ "node", "server.js" ]
