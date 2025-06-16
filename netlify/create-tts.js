// 파일 경로: /netlify/functions/create-tts.js (최종 완성본)

const fetch = require('node-fetch');

const API_TOKEN = process.env.TYPECAST_API_KEY;
const ACTOR_ID = process.env.TYPECAST_ACTOR_ID;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

exports.handler = async (event, context) => {
    
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

    if (!API_TOKEN || !ACTOR_ID) {
        const errorMessage = "서버 설정 오류: API 키 또는 배우 ID가 설정되지 않았습니다.";
        console.error(errorMessage);
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: errorMessage })
        };
    }

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
            const errorText = await initialResponse.text();
            console.error('Typecast API Error:', errorText);
            throw new Error(`Typecast API가 에러를 반환했습니다 (상태: ${initialResponse.status})`);
        }

        const initialJson = await initialResponse.json();
        const pollingUrl = initialJson.result?.speak_v2_url;
        if (!pollingUrl) throw new Error('speak_v2_url을 받지 못했습니다.');

        let audioDownloadUrl = null;
        for (let i = 0; i < 20; i++) {
            await sleep(1000);
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
