const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');

const app = express();
app.use(cors()); // CORS 문제 해결
app.use(express.json({ limit: '50mb' })); // 대용량 JSON 데이터 수신 가능하도록

// "영상 만들어줘" 라는 요청을 처리할 주소
app.post('/render-video', (req, res) => {
    const projectData = req.body; // SunsakTool에서 보낸 설계도
    console.log('✅ 렌더링 요청 받음!');
    
    // 1. 여기서 projectData를 분석해서 FFmpeg 명령어를 만듭니다. (이게 핵심!)
    // 지금은 테스트를 위해 간단한 명령어만 실행해 봅니다.
    const ffmpegCommand = `ffmpeg -f lavfi -i testsrc=size=1920x1080:rate=30:duration=5 -pix_fmt yuv420p output.mp4 -y`;

    console.log('🚀 FFmpeg 실행:', ffmpegCommand);

    // 2. FFmpeg 명령어 실행
    exec(ffmpegCommand, (error, stdout, stderr) => {
        if (error) {
            console.error(`❌ 렌더링 오류: ${error.message}`);
            res.status(500).send({ message: '렌더링 실패', error: stderr });
            return;
        }
        console.log('🎉 영상 렌더링 성공!');
        res.send({ message: '렌더링 성공!', videoPath: 'output.mp4' });
    });
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 렌더링 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
