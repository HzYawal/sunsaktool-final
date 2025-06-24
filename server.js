// server.js (수정본)

const express = require('express');
const path = require('path');
const fetch = require('node-fetch'); // node-fetch 라이브러리를 사용하기 위해 추가

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '')));

// [추가] TTS 요청을 Netlify로 중계해주는 API
app.post('/api/create-tts', async (req, res) => {
    console.log("TTS 중계 요청 받음:", req.body);
    try {
        const ttsResponse = await fetch('https://sunsaktool-final.netlify.app/.netlify/functions/create-tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });

        if (!ttsResponse.ok) {
            const errorText = await ttsResponse.text();
            throw new Error(`Netlify 함수 오류: ${errorText}`);
        }

        const result = await ttsResponse.json();
        res.json(result);

    } catch (error) {
        console.error('TTS 중계 중 오류 발생:', error);
        res.status(500).json({ error: error.message });
    }
});


// 영상 저장 요청 API
app.post('/render-video', (req, res) => {
    console.log("'/render-video' API 호출됨!");
    const projectData = req.body;
    console.log("프론트엔드로부터 받은 데이터:", JSON.stringify(projectData, null, 2));
    
    setTimeout(() => {
        res.json({
            success: true,
            message: "영상 제작 요청을 성공적으로 받았습니다. (가짜 응답)",
            downloadUrl: "https://sunsaktool-final.netlify.app/cute-puppy.mp3"
        });
    }, 2000);
});

app.listen(PORT, () => {
    console.log(`=============================================`);
    console.log(`  SunsakTool 서버가 실행되었습니다!`);
    // [수정] 안내 메시지를 index.html로 변경
    console.log(`  브라우저에서 http://localhost:${PORT} 로 접속하세요.`);
    console.log(`=============================================`);
});
