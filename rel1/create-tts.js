// 파일 경로: /netlify/functions/create-tts.js

const fetch = require('node-fetch');

// API 키와 배우 ID를 환경 변수에서 안전하게 불러옵니다.
const API_TOKEN = process.env.TYPECAST_API_KEY;
const ACTOR_ID = process.env.TYPECAST_ACTOR_ID;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { text } = JSON.parse(event.body);
        if (!text) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Text is required' }) };
        }

        // --- Step 1: 음성 합성 요청 ---
        const initialResponse = await fetch('https://typecast.ai/api/speak', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_TOKEN}`,
            },
            body: JSON.stringify({
                text: text,
                actor_id: ACTOR_ID,
                lang: "auto",
                tempo: 1.5,                 // ✅ 요청하신 대로 1.5 속도를 유지합니다.
                volume: 100,
                pitch: 0,
                xapi_hd: true,
                max_seconds: 60,
                model_version: "latest",
                xapi_audio_format: "wav"
            })
        });

        if (!initialResponse.ok) {
            const errorJson = await initialResponse.json();
            throw new Error(`[${initialResponse.status}] Typecast API Error: ${errorJson.message || 'Initial request failed'}`);
        }

        const initialJson = await initialResponse.json();
        const pollingUrl = initialJson.result?.speak_v2_url;

        if (!pollingUrl) {
            throw new Error('speak_v2_url not found in the initial response.');
        }

        // --- Step 2: 'done' 상태가 될 때까지 Polling ---
        let audioDownloadUrl = null;
        for (let i = 0; i < 20; i++) {
            await sleep(1000);
            const pollResponse = await fetch(pollingUrl, { headers: { 'Authorization': `Bearer ${API_TOKEN}` } });
            if (!pollResponse.ok) throw new Error(`[${pollResponse.status}] Polling failed`);
            const pollResult = await pollResponse.json();
            const { status, audio_download_url } = pollResult.result;
            if (status === 'done') {
                audioDownloadUrl = audio_download_url;
                break;
            } else if (status !== 'progress') {
                throw new Error(`TTS job failed with status: ${status}`);
            }
        }

        if (!audioDownloadUrl) throw new Error('TTS job timed out after 20 seconds.');

        // --- Step 3: 성공 시, 최종 오디오 URL을 프론트엔드로 전달 ---
        return {
            statusCode: 200,
            body: JSON.stringify({ audioUrl: audioDownloadUrl }),
        };

    } catch (error) {
        console.error('Backend TTS Error:', error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};