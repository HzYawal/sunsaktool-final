// 파일 경로: /netlify/create-image.js (html-css-to-image 최종 버전)

const fetch = require('node-fetch');

// Netlify 환경 변수에서 API 키 정보를 가져옵니다.
const HCTI_API_USER_ID = process.env.HCTI_API_USER_ID;
const HCTI_API_KEY = process.env.HCTI_API_KEY;

exports.handler = async (event, context) => {
    // CORS 및 기본 요청 방식 확인
    if (event.httpMethod === 'OPTIONS') { /* ... CORS ... */ return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' } }; }
    if (event.httpMethod !== 'POST') { return { statusCode: 405, headers: {'Access-Control-Allow-Origin': '*'}, body: 'Method Not Allowed' }; }
    
    // API 키가 설정되었는지 먼저 확인
    if (!HCTI_API_USER_ID || !HCTI_API_KEY) {
        const errorMessage = "서버 설정 오류: html-css-to-image API 키가 설정되지 않았습니다.";
        console.error(errorMessage);
        return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: errorMessage }) };
    }

    try {
        const { html, css } = JSON.parse(event.body);
        if (!html || !css) throw new Error("HTML 또는 CSS 데이터가 없습니다.");

        // html-css-to-image API에 이미지 생성을 요청합니다.
        const response = await fetch('https://hcti.io/v1/image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // Basic Auth를 사용하여 User ID와 API Key를 전달합니다.
            'Authorization': 'Basic ' + Buffer.from(`${HCTI_API_USER_ID}:${HCTI_API_KEY}`).toString('base64'),
            body: JSON.stringify({ html, css, google_fonts: "Noto Sans KR" })
        });

        if (!response.ok) {
            const errorResult = await response.json();
            throw new Error(errorResult.error || '이미지 생성 API 호출에 실패했습니다.');
        }

        const result = await response.json();
        
        // API가 생성해준 이미지의 URL을 반환합니다.
        return {
            statusCode: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ imageUrl: result.url }),
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
