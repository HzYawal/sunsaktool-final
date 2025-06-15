// 파일 경로: /netlify/functions/create-tts.js (최종 방어 코드 적용 버전)

// 'node-fetch'는 Netlify의 기본 런타임에 포함되어 있을 수 있지만,
// 만약을 위해 명시적으로 require합니다.
const fetch = require('node-fetch');

// 환경 변수를 가장 먼저 읽어옵니다.
const API_TOKEN = process.env.TYPECAST_API_KEY;
const ACTOR_ID = process.env.TYPECAST_ACTOR_ID;

exports.handler = async (event, context) => {
    
    // CORS Preflight 요청을 가장 먼저 처리합니다.
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

    // POST가 아니면 거부합니다.
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: {'Access-Control-Allow-Origin': '*'}, body: 'Method Not Allowed' };
    }

    // ========= ✨✨✨ 가장 중요한 방어 코드 ✨✨✨ =========
    // 함수가 실행되자마자 환경 변수가 있는지부터 확인합니다.
    if (!API_TOKEN || !ACTOR_ID) {
        const errorMessage = "서버 설정 오류: Typecast API 키 또는 배우 ID가 설정되지 않았습니다. Netlify 대시보드에서 환경 변수를 다시 확인하고, 최근 배포가 완료되었는지 확인하세요.";
        console.error(errorMessage); // 서버 로그에 명확한 에러 기록
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: errorMessage }) // 프론트엔드에도 명확한 에러 전달
        };
    }
    // =======================================================

    try {
        const { text } = JSON.parse(event.body);
        if (!text) {
            return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Text is required' }) };
        }
        
        const initialResponse = await fetch('https://typecast.ai/api/speak', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_TOKEN}` },
            body: JSON.stringify({
                text: text, actor_id: ACTOR_ID, lang: "auto", tempo: 1.5, volume: 100, pitch: 0,
                xapi_hd: true, max_seconds: 60, model_version: "latest", xapi_audio_format: "wav"
            })
        });

        if (!initialResponse.ok) {
            // Typecast API가 에러를 반환했을 때, 그 내용을 그대로 로그에 기록합니다.
            const errorText = await initialResponse.text();
            console.error('Typecast API Error:', errorText);
            throw new Error(`Typecast API가 에러를 반환했습니다 (상태: ${initialResponse.status})`);
        }

        const initialJson = await initialResponse.json();
        const pollingUrl = initialJson.result?.speak_v2_url;
        if (!pollingUrl) throw new Error('speak_v2_url을 받지 못했습니다.');

        let audioDownloadUrl = null;
        for (let i = 0; i < 20; i++) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            const pollResponse = await fetch(pollingUrl, { headers: { 'Authorization': `Bearer ${API_TOKEN}` } });
            if (!pollResponse.ok) throw new Error(`Polling에 실패했습니다 (상태: ${pollResponse.status})`);
            
            const pollResult = await pollResponse.json();
            const { status, audio_download_url } = pollResult.result;

            if (status === 'done') {
                audioDownloadUrl = audio_download_url;
                break;
            } else if (status !== 'progress') {
                throw new Error(`TTS 작업 실패 (상태: ${status})`);
            }
        }

        if (!audioDownloadUrl) throw new Error('TTS 작업 시간 초과');

        return {
            statusCode: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ audioUrl: audioDownloadUrl }),
        };

    } catch (error) {
        console.error('핸들러 내부에서 심각한 오류 발생:', error);
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: error.message }),
        };
    }
};
