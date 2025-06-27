// ================== [server.js 최종 완성본 - 생략/중략 없음] ==================
const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const { exec } = require('child_process');
const fetch = require('node-fetch');
const { TextToSpeechClient } = require('@google-cloud/text-to-speech');
const cors = require('cors');
const puppeteer = require('puppeteer'); 
const os = require('os');

// [추가된 부분 시작]
const { PubSub } = require('@google-cloud/pubsub');
const { Storage } = require('@google-cloud/storage');
const { Firestore } = require('@google-cloud/firestore');
const { v4: uuidv4 } = require('uuid');

// --- Google Cloud 서비스 클라이언트 초기화 ---
// 한 번만 생성하여 재사용합니다.
const ttsClient = new TextToSpeechClient();
const pubSubClient = new PubSub();
const storage = new Storage();
const firestore = new Firestore();

// --- 환경 설정 ---
// Pub/Sub 토픽 이름과 스토리지 버킷 이름. 실제 GCP 프로젝트에 맞게 설정해야 합니다.
const RENDER_TOPIC_NAME = 'sunsak-render-jobs';
const OUTPUT_BUCKET_NAME = 'sunsak-output-videos'; 
// [추가된 부분 끝]
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.static(__dirname));

// 구글 TTS API
app.post('/api/create-tts', async (req, res) => {
    const { text, voice, speed } = req.body;
    if (!text || !text.trim()) { return res.status(400).json({ error: 'TTS로 변환할 텍스트가 없습니다.' }); }
    const selectedVoice = voice || 'ko-KR-Standard-C';
    const speakingRate = parseFloat(speed) || 1.0; 
    const client = new TextToSpeechClient();
    const ssmlText = `<speak><prosody rate="${speakingRate}">${text}</prosody></speak>`;
    try {
        const request = { input: { ssml: ssmlText }, voice: { languageCode: 'ko-KR', name: selectedVoice }, audioConfig: { audioEncoding: 'MP3' }, };
        const [response] = await client.synthesizeSpeech(request);
        const audioBase64 = response.audioContent.toString('base64');
        const audioUrl = `data:audio/mp3;base64,${audioBase64}`;
        res.json({ audioUrl: audioUrl });
    } catch (error) { console.error('구글 TTS API 호출 중 오류 발생:', error); res.status(500).json({ error: error.message }); }
});

// =================== [붙여넣을 코드 블록 시작] ===================

// [수정된 API] 영상 렌더링 '요청 접수' API
app.post('/render-video', async (req, res) => {
    try {
        const projectData = req.body;
        if (!projectData || !projectData.scriptCards || projectData.scriptCards.length === 0) {
            return res.status(400).json({ message: '렌더링할 데이터가 없습니다.' });
        }

        // 1. 고유한 작업 ID 생성
        const jobId = uuidv4();
        console.log(`[${jobId}] 신규 렌더링 작업 접수`);

        // 2. 작업 상태를 Firestore에 '대기중(pending)'으로 기록
        const jobRef = firestore.collection('renderJobs').doc(jobId);
        await jobRef.set({
            jobId: jobId,
            status: 'pending',
            message: '렌더링 대기 중입니다.',
            createdAt: new Date(),
            progress: 0
        });

        // 3. 렌더링할 데이터(projectData)와 jobId를 Pub/Sub 토픽에 발행(전송)
        const dataBuffer = Buffer.from(JSON.stringify({ jobId, projectData }));
        const messageId = await pubSubClient.topic(RENDER_TOPIC_NAME).publishMessage({ data: dataBuffer });
        console.log(`[${jobId}] Pub/Sub에 메시지 발행 완료 (Message ID: ${messageId})`);

        // 4. 사용자에게 즉시 jobId와 함께 성공 응답 전송
        res.status(202).json({ 
            success: true, 
            message: '영상 제작 요청이 성공적으로 접수되었습니다.',
            jobId: jobId
        });

    } catch (error) {
        console.error('렌더링 요청 접수 중 오류:', error);
        res.status(500).json({ success: false, message: '서버 내부 오류가 발생했습니다.' });
    }
});

// [신규 API] 작업 상태 확인 API
app.get('/render-status/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        const jobRef = firestore.collection('renderJobs').doc(jobId);
        const doc = await jobRef.get();

        if (!doc.exists) {
            return res.status(404).json({ message: '해당 작업을 찾을 수 없습니다.' });
        }
        
        // Firestore에 저장된 작업 데이터를 그대로 반환
        res.status(200).json(doc.data());

    } catch (error) {
        console.error(`[${req.params.jobId}] 상태 확인 중 오류:`, error);
        res.status(500).json({ message: '서버 내부 오류가 발생했습니다.' });
    }
});

// =================== [붙여넣을 코드 블록 끝] ===================

app.listen(PORT, '0.0.0.0', () => {
    console.log(`=============================================`);
    console.log(`  SunsakTool 서버가 ${PORT} 포트에서 실행되었습니다!`);
    console.log(`=============================================`);
});
