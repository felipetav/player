const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const mongoose = require('mongoose');
const app = express();

app.use(cors());
app.use(express.json());

// 1. CONNECT TO MONGODB
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('Connected to MongoDB!'))
    .catch(err => console.error('Mongo Error:', err));

// 2. DEFINE SCHEMA
const DialogueSchema = new mongoose.Schema({
    number: { type: Number, required: true, unique: true },
    title: String,
    audioDriveId: String,
    transcriptText: String,
    highlights: [{
        russian: String,
        translation: String,
        date: { type: Date, default: Date.now }
    }]
});

const Dialogue = mongoose.model('Dialogue', DialogueSchema);

// GOOGLE DRIVE SETUP
const getAuth = () => {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    return new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
};

// !!! REPLACE THIS WITH YOUR REAL FOLDER ID !!!
const FOLDER_ID = '1xA6Ckfyi_mXEES4h_olxmnJm2i8ueECR'; 

app.get('/', (req, res) => res.send('Dialogue API is Running 🚀'));

// HELPER: Download text from Drive
async function downloadDriveText(fileId) {
    const auth = getAuth();
    const drive = google.drive({ version: 'v3', auth });
    const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' });
    return res.data;
}

// A. LIST DIALOGUES (Improved)
app.get('/api/dialogues', async (req, res) => {
    try {
        const auth = getAuth();
        const drive = google.drive({ version: 'v3', auth });
        
        // Look for BOTH audio and transcripts
        const driveRes = await drive.files.list({
            q: `'${FOLDER_ID}' in parents and trashed=false`,
            fields: 'files(id, name)',
            pageSize: 1000
        });

        const dbDialogues = await Dialogue.find();
        const dialogues = {};

        // Pair up Drive files
        driveRes.data.files.forEach(file => {
            // Check for audioN
            const audioMatch = file.name.match(/^audio(\d+)\./i);
            if (audioMatch) {
                const num = parseInt(audioMatch[1]);
                if (!dialogues[num]) dialogues[num] = { number: num };
                dialogues[num].audioId = file.id;
            }
            // Check for transcriptN
            const textMatch = file.name.match(/^transcript(\d+)\.txt$/i);
            if (textMatch) {
                const num = parseInt(textMatch[1]);
                if (!dialogues[num]) dialogues[num] = { number: num };
                dialogues[num].transcriptId = file.id;
            }
        });

        // Merge with DB data
        const result = Object.values(dialogues).map(d => {
            const dbEntry = dbDialogues.find(db => db.number === d.number);
            return {
                number: d.number,
                label: dbEntry?.title || `Dialogue ${d.number}`,
                audioId: d.audioId,
                transcriptId: d.transcriptId, // We send this just in case
                hasHighlights: (dbEntry?.highlights || []).length > 0
            };
        }).sort((a, b) => a.number - b.number);

        res.json(result);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// B. GET SINGLE DIALOGUE (With Smart Import)
app.get('/api/dialogues/:number', async (req, res) => {
    try {
        const num = parseInt(req.params.number);
        let doc = await Dialogue.findOne({ number: num });

        // LOGIC: If DB has no text, try to fetch from Drive!
        if (!doc || !doc.transcriptText) {
            console.log(`DB empty for Dialogue ${num}. Checking Drive...`);
            
            // 1. Find the transcript file ID in Drive again
            const auth = getAuth();
            const drive = google.drive({ version: 'v3', auth });
            const listRes = await drive.files.list({
                q: `'${FOLDER_ID}' in parents and name = 'transcript${num}.txt'`,
                fields: 'files(id)',
            });

            if (listRes.data.files.length > 0) {
                // 2. Found it! Download text
                const txtId = listRes.data.files[0].id;
                const textContent = await downloadDriveText(txtId);
                
                // 3. Save to DB so we don't have to ask Drive next time
                if (!doc) doc = new Dialogue({ number: num, title: `Dialogue ${num}` });
                doc.transcriptText = textContent;
                await doc.save();
                console.log(`Imported text for Dialogue ${num} from Drive.`);
            }
        }

        res.json({
            transcript: doc?.transcriptText || "",
            highlights: doc?.highlights || []
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// C. SAVE HIGHLIGHTS
app.post('/api/dialogues/:number/highlights', async (req, res) => {
    try {
        const num = req.params.number;
        let doc = await Dialogue.findOne({ number: num });
        if (!doc) {
            doc = new Dialogue({ number: num, title: `Dialogue ${num}` });
        }
        doc.highlights = req.body;
        await doc.save();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// D. STREAM AUDIO
app.get('/api/audio/:fileId', async (req, res) => {
    try {
        const auth = getAuth();
        const drive = google.drive({ version: 'v3', auth });
        const result = await drive.files.get(
            { fileId: req.params.fileId, alt: 'media' },
            { responseType: 'stream' }
        );
        result.data.pipe(res);
    } catch (error) {
        res.status(500).send('Audio Error');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
