// server.js
const express = require('express');
const path = require('path');
const app = express();
const PORT = 3000; // 서버가 실행될 포트

// JSON 요청 본문을 파싱하기 위한 미들웨어
app.use(express.json({ limit: '50mb' }));

// 정적 파일(HTML, CSS, JS, 이미지 등)을 제공하기 위한 미들웨어
// 프로젝트의 모든 파일을 현재 폴더 기준으로 제공합니다.
app.use(express.static(path.join(__dirname, '')));

// '/render-video' 경로로 POST 요청이 오면 이 함수가 실행됩니다.
app.post('/render-video', (req, res) => {
    console.log("'/render-video' API 호출됨!");

    // 프론트엔드에서 보낸 프로젝트 데이터를 콘솔에 출력해봅니다.
    const projectData = req.body;
    console.log("프론트엔드로부터 받은 데이터:", JSON.stringify(projectData, null, 2));

    // --- 지금은 실제 렌더링 대신, 성공했다는 가짜 응답을 보냅니다. ---
    // 나중에 이 부분에 Puppeteer + FFmpeg 로직이 들어갑니다.
    console.log("2초 후, 가짜 영상 링크를 응답으로 보냅니다.");
    
    setTimeout(() => {
        res.json({
            success: true,
            message: "영상 제작 요청을 성공적으로 받았습니다. (가짜 응답)",
            downloadUrl: "https://sunsaktool-final.netlify.app/cute-puppy.mp3" // 임시로 아무 파일 링크나 보냅니다.
        });
    }, 2000); // 2초 딜레이를 줘서 서버가 일하는 것처럼 보이게 합니다.
});

// 서버를 지정된 포트에서 실행합니다.
app.listen(PORT, () => {
    console.log(`=============================================`);
    console.log(`  SunsakTool 서버가 실행되었습니다!`);
    console.log(`  브라우저에서 http://localhost:${PORT}/tool.html 로 접속하세요.`);
    console.log(`=============================================`);
});
