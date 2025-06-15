// 파일 경로: /netlify/render-video.js (Canvas 단독 테스트용 최종본)

const { createCanvas } = require('canvas');
const fs = require('fs');
const os = require('os');
const path = require('path');

exports.handler = async (event, context) => {
    // CORS Preflight 요청 처리
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST, OPTIONS'
            }
        };
    }
    
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: {'Access-Control-Allow-Origin': '*'}, body: 'Method Not Allowed' };
    }

    try {
        const projectData = JSON.parse(event.body);
        const firstScene = projectData.scenes[0];
        if (!firstScene) throw new Error("출력할 씬이 없습니다.");

        const width = 1080;
        const height = 1920;
        const canvas = createCanvas(width, height);
        const context = canvas.getContext('2d');
        
        context.fillStyle = '#fff';
        context.fillRect(0, 0, width, height);

        context.fillStyle = '#000';
        context.font = 'bold 72px sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(firstScene.text, width / 2, height / 2);
        
        // Netlify 서버의 유일한 쓰기 가능 공간인 /tmp에 저장
        const tempDir = os.tmpdir();
        const imagePath = path.join(tempDir, `frame-${Date.now()}.png`);
        const buffer = canvas.toBuffer('image/png');
        fs.writeFileSync(imagePath, buffer);

        // FFmpeg 없이, 이미지 생성 성공 여부만 반환
        return {
            statusCode: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ 
                message: "Canvas 이미지 생성 및 저장 성공!",
                imagePath: imagePath 
            }),
        };

    } catch (error) {
        console.error('Canvas 테스트 핸들러 오류:', error);
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: error.message }),
        };
    }
};
