// 파일 경로: /netlify/create-image.js (이미지 생성 최종 버전)

const { createCanvas } = require('canvas');

exports.handler = async (event, context) => {
    // CORS 및 기본 요청 방식 확인
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
        };
    }
    if (event.httpMethod !== 'POST') { return { statusCode: 405, headers: {'Access-Control-Allow-Origin': '*'}, body: 'Method Not Allowed' }; }

    try {
        const projectData = JSON.parse(event.body);
        const firstScene = projectData.scenes[0];
        if (!firstScene) throw new Error("출력할 씬이 없습니다.");

        const width = 1080;
        const height = 1920;
        const canvas = createCanvas(width, height);
        const context = canvas.getContext('2d');
        
        // 흰색 배경 그리기
        context.fillStyle = '#fff';
        context.fillRect(0, 0, width, height);
        
        // 스크립트 텍스트 그리기
        context.fillStyle = firstScene.style.color || '#000';
        context.font = `${firstScene.style.fontSize || 70}px sans-serif`; 
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(firstScene.text, width / 2, height / 2);
        
        // 완성된 이미지를 고품질 JPEG 데이터(Buffer)로 변환
        const buffer = canvas.toBuffer('image/jpeg', { quality: 0.95 });

        // 이미지 데이터를 Base64 문자열로 암호화하여 브라우저로 전달
        return {
            statusCode: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ 
                message: "이미지 생성 성공!",
                imageData: buffer.toString('base64') 
            }),
        };

    } catch (error) {
        console.error('이미지 생성 핸들러 오류:', error);
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: error.message }),
        };
    }
};
