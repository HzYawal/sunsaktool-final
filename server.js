// ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼ 이 코드로 server.js 전체를 교체하세요 ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼

// ================== [server.js 최종 완성본] ==================
const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const fetch = require('node-fetch');

// Google Cloud 클라이언트
const { TextToSpeechClient } = require('@google-cloud/text-to-speech');
const { PubSub } = require('@google-cloud/pubsub');
const { Firestore } = require('@google-cloud/firestore');
const { Storage } = require('@google-cloud/storage');

// --- 환경 설정 및 클라이언트 초기화 ---
const GCP_PROJECT_ID = process.env.GCP_PROJECT || 'sunsak-tool-gcp';

const ttsClient = new TextToSpeechClient({ projectId: GCP_PROJECT_ID });
const pubSubClient = new PubSub({ projectId: GCP_PROJECT_ID });
const firestore = new Firestore({ projectId: GCP_PROJECT_ID });
const storage = new Storage({ projectId: GCP_PROJECT_ID });

const RENDER_TOPIC_NAME = 'sunsak-render-jobs';
const JOB_DATA_BUCKET_NAME = 'sunsak-job-data';

const app = express();
const PORT = process.env.PORT || 3000;

// --- 미들웨어 ---
app.use(cors());
// body-parser의 limit을 늘려서 큰 JSON 데이터를 받을 수 있도록 함
app.use(express.json({ limit: '150mb' }));
app.use(express.static(__dirname));

// --- API 엔드포인트 ---

// 1. TTS 생성 API
app.post('/api/create-tts', async (req, res) => {
    const { text, voice, speed } = req.body;
    if (!text || !text.trim()) {
        return res.status(400).json({ error: 'TTS로 변환할 텍스트가 없습니다.' });
    }
    const selectedVoice = voice || 'ko-KR-Standard-C';
    const speakingRate = parseFloat(speed) || 1.0;
    const ssmlText = `<speak><prosody rate="${speakingRate}">${text}</prosody></speak>`;

    try {
        const request = {
            input: { ssml: ssmlText },
            voice: { languageCode: 'ko-KR', name: selectedVoice },
            audioConfig: { audioEncoding: 'MP3' }
        };
        const [response] = await ttsClient.synthesizeSpeech(request);
        const audioUrl = `data:audio/mp3;base64,${response.audioContent.toString('base64')}`;
        res.json({ audioUrl });
    } catch (error) {
        console.error('구글 TTS API 호출 중 오류 발생:', error);
        res.status(500).json({ error: error.message });
    }
});

// 2. 외부 리소스 프록시 API (html-to-image/html2canvas용)
app.get('/api/proxy', async (req, res) => {
    const { url } = req.query;
    if (!url) {
        return res.status(400).send('URL is required');
    }
    try {
        const response = await fetch(decodeURIComponent(url));
        if (!response.ok) {
            return res.status(response.status).send(response.statusText);
        }
        res.setHeader('Content-Type', response.headers.get('Content-Type'));
        response.body.pipe(res);
    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).send('Error fetching the URL');
    }
});

// 3. 영상 제작 요청 API (핵심 로직)
app.post('/render-video', async (req, res) => {
    const jobId = uuidv4();
    try {
        const projectData = req.body;
        if (!projectData || !projectData.scriptCards || projectData.scriptCards.length === 0) {
    return res.status(400).json({ message: '렌더링할 데이터(scriptCards)가 없습니다.' });
}
        console.log(`[${jobId}] 신규 렌더링 작업 접수`);

        // 단계 1: Firestore에 작업 상태 기록
        const jobRef = firestore.collection('renderJobs').doc(jobId);
        await jobRef.set({ jobId, status: 'pending', message: '렌더링 대기 중입니다.', createdAt: new Date(), progress: 0 });

        // 단계 2: 거대한 projectData를 GCS에 JSON 파일로 업로드
        const bucket = storage.bucket(JOB_DATA_BUCKET_NAME);
        const file = bucket.file(`${jobId}.json`);
        await file.save(JSON.stringify(projectData), { contentType: 'application/json' });
        console.log(`[${jobId}] 작업 데이터를 GCS(${JOB_DATA_BUCKET_NAME}/${jobId}.json)에 저장 완료`);

        // 단계 3: Pub/Sub에는 가벼운 jobId만 담아서 보냄
        const dataBuffer = Buffer.from(JSON.stringify({ jobId }));
        await pubSubClient.topic(RENDER_TOPIC_NAME).publishMessage({ data: dataBuffer });
        console.log(`[${jobId}] Pub/Sub에 작업 메시지 발행 완료`);
        
        res.status(202).json({ success: true, message: '영상 제작 요청이 성공적으로 접수되었습니다.', jobId });
    } catch (error) {
        console.error(`[${jobId}] 렌더링 요청 접수 중 오류:`, error);
        // 오류 발생 시 Firestore에 실패 상태 기록
        await firestore.collection('renderJobs').doc(jobId).set({ status: 'failed', message: `요청 접수 실패: ${error.message}` }, { merge: true });
        res.status(500).json({ success: false, message: '서버 내부 오류가 발생했습니다.' });
    }
});

// 4. 렌더링 상태 확인 API
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

// ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲
