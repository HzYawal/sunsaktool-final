// ================== [server.js - 최종 수정본] ==================
const express = require('express');
const path = require('path');
const { TextToSpeechClient } = require('@google-cloud/text-to-speech');
const { PubSub } = require('@google-cloud/pubsub');
const { Firestore } = require('@google-cloud/firestore');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

// --- 환경 설정 및 클라이언트 초기화 ---
const GCP_PROJECT_ID = 'sunsak-tool-gcp';
const KEY_FILE_PATH = path.join(__dirname, 'sunsak-key.json');

const ttsClient = new TextToSpeechClient({ projectId: GCP_PROJECT_ID, keyFilename: KEY_FILE_PATH });
const pubSubClient = new PubSub({ projectId: GCP_PROJECT_ID, keyFilename: KEY_FILE_PATH });
const firestore = new Firestore({ projectId: GCP_PROJECT_ID, keyFilename: KEY_FILE_PATH });

const RENDER_TOPIC_NAME = 'sunsak-render-jobs';
const app = express();
const PORT = process.env.PORT || 3000;

// --- 미들웨어 ---
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.static(__dirname));

// --- API 엔드포인트 ---
app.post('/api/create-tts', async (req, res) => {
    const { text, voice, speed } = req.body;
    if (!text || !text.trim()) { return res.status(400).json({ error: 'TTS로 변환할 텍스트가 없습니다.' }); }
    const selectedVoice = voice || 'ko-KR-Standard-C';
    const speakingRate = parseFloat(speed) || 1.0;
    const ssmlText = `<speak><prosody rate="${speakingRate}">${text}</prosody></speak>`;
    try {
        const request = { input: { ssml: ssmlText }, voice: { languageCode: 'ko-KR', name: selectedVoice }, audioConfig: { audioEncoding: 'MP3' } };
        const [response] = await ttsClient.synthesizeSpeech(request);
        const audioBase64 = response.audioContent.toString('base64');
        const audioUrl = `data:audio/mp3;base64,${audioBase64}`;
        res.json({ audioUrl: audioUrl });
    } catch (error) { console.error('구글 TTS API 호출 중 오류 발생:', error); res.status(500).json({ error: error.message }); }
});

app.post('/render-video', async (req, res) => {
    try {
        const projectData = req.body;
        if (!projectData || !projectData.scriptCards || projectData.scriptCards.length === 0) {
            return res.status(400).json({ message: '렌더링할 데이터가 없습니다.' });
        }
        const jobId = uuidv4();
        console.log(`[${jobId}] 신규 렌더링 작업 접수`);
        const jobRef = firestore.collection('renderJobs').doc(jobId);
        await jobRef.set({ jobId: jobId, status: 'pending', message: '렌더링 대기 중입니다.', createdAt: new Date(), progress: 0 });
        const dataBuffer = Buffer.from(JSON.stringify({ jobId, projectData }));
        const messageId = await pubSubClient.topic(RENDER_TOPIC_NAME).publishMessage({ data: dataBuffer });
        console.log(`[${jobId}] Pub/Sub에 메시지 발행 완료 (Message ID: ${messageId})`);
        res.status(202).json({ success: true, message: '영상 제작 요청이 성공적으로 접수되었습니다.', jobId: jobId });
    } catch (error) {
        console.error('렌더링 요청 접수 중 오류:', error);
        res.status(500).json({ success: false, message: '서버 내부 오류가 발생했습니다.' });
    }
});

app.get('/render-status/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        const jobRef = firestore.collection('renderJobs').doc(jobId);
        const doc = await jobRef.get();
        if (!doc.exists) {
            return res.status(404).json({ message: '해당 작업을 찾을 수 없습니다.' });
        }
        res.status(200).json(doc.data());
    } catch (error) {
        console.error(`[${req.params.jobId}] 상태 확인 중 오류:`, error);
        res.status(500).json({ message: '서버 내부 오류가 발생했습니다.' });
    }
});

// --- 서버 실행 ---
app.listen(PORT, '0.0.0.0', () => {
    console.log(`=============================================`);
    console.log(`  SunsakTool API 서버가 ${PORT} 포트에서 실행되었습니다!`);
    console.log(`=============================================`);
});
