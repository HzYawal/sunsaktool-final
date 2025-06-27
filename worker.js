// ===============================================
//  Puppeteer 실행을 위한 최소 기능 테스트 worker.js
// ===============================================

console.log('--- [1] 테스트 워커 실행 시작 ---');

const express = require('express');
const puppeteer = require('puppeteer');

console.log('--- [2] 모듈 로딩 완료, Puppeteer 실행 시도 ---');

async function runTest() {
    let browser;
    try {
        console.log('--- [3] puppeteer.launch() 호출 시작 ---');
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        console.log('--- [4] Puppeteer 브라우저 성공적으로 실행됨! ---');

        await browser.close();
        
        console.log('--- [5] 브라우저 종료 완료. 테스트 성공! ---');
        
        return "Puppeteer Test Succeeded!";

    } catch (e) {
        console.error('--- [!!!] Puppeteer 실행 중 치명적인 오류 발생 ---');
        console.error(e);
        return "Puppeteer Test Failed!";
    }
}


const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', async (req, res) => {
  // 루트 경로로 접근하면 즉시 퍼펫티어 테스트를 실행하고 결과를 보여줌
  const result = await runTest();
  res.status(200).send(`Test Result: ${result}`);
});

app.listen(PORT, () => {
  console.log(`테스트 워커가 ${PORT} 포트에서 실행되었습니다.`);
  console.log('루트 URL에 접속하여 테스트를 실행할 수 있습니다.');
});
