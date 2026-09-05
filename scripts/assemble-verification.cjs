const fs = require('fs');
const readline = require('readline');

async function extractChunks(filePath) {
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  const views = [];

  for await (const line of rl) {
    if (line.includes('File Path: `file:///d:/Projects/Finvestigate/src/verification.ts`') || line.includes('File Path: `file:///d:\\Projects\\Finvestigate\\src\\verification.ts`')) {
      const obj = JSON.parse(line);
      const match = obj.content && obj.content.match(/Showing lines (\d+) to (\d+)/);
      if (match) {
        views.push({
          start: parseInt(match[1], 10),
          end: parseInt(match[2], 10),
          content: obj.content
        });
      }
    }
  }
  return views;
}

async function main() {
  const views1 = await extractChunks('C:/Users/dhanu/.gemini/antigravity-ide/brain/08cfcacb-7913-457e-b284-17077903b2bc/.system_generated/logs/transcript_full.jsonl');
  const views2 = await extractChunks('C:/Users/dhanu/.gemini/antigravity-ide/brain/cfab6c2e-2ed0-44c8-86b8-41e123039274/.system_generated/logs/transcript_full.jsonl');
  const views3 = await extractChunks('C:/Users/dhanu/.gemini/antigravity-ide/brain/3ff0fa1c-a297-4819-9ece-06b85da402c7/.system_generated/logs/transcript_full.jsonl');

  console.log('08cfcacb chunks:');
  views1.forEach(v => console.log(`Lines ${v.start} - ${v.end}`));

  console.log('cfab6c2e chunks:');
  views2.forEach(v => console.log(`Lines ${v.start} - ${v.end}`));

  console.log('3ff0fa1c chunks:');
  views3.forEach(v => console.log(`Lines ${v.start} - ${v.end}`));
}

main();
