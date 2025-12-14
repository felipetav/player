const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const app = express();

// Allow your GitHub Pages to talk to this server
app.use(cors());

// Load credentials from Environment Variable (we set this in Step 3)
const getAuth = () => {
    // We will paste the JSON content into an ENV variable named GOOGLE_CREDENTIALS
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    return new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
};

// Replace this with your specific Google Drive Folder ID
// (Open folder in browser -> look at URL -> folders/YOUR_ID_IS_HERE)
const FOLDER_ID = '1xA6Ckfyi_mXEES4h_olxmnJm2i8ueECR'; 

app.get('/', (req, res) => {
    res.send('Dialogue Backend is running! 🚀');
});

// 1. List Dialogues
app.get('/api/dialogues', async (req, res) => {
    try {
        const auth = getAuth();
        const drive = google.drive({ version: 'v3', auth });

        // List all files in the folder
        const response = await drive.files.list({
            q: `'${FOLDER_ID}' in parents and trashed=false`,
            fields: 'files(id, name)',
            pageSize: 1000
        });

        const files = response.data.files;
        const dialogues = {};

        // Group audio and transcript by number
        files.forEach(file => {
            // Check for audio1.mp3/wav/webm
            const audioMatch = file.name.match(/^audio(\d+)\.(mp3|wav|webm)$/i);
            // Check for transcript1.txt
            const textMatch = file.name.match(/^transcript(\d+)\.txt$/i);

            if (audioMatch) {
                const num = audioMatch[1];
                if (!dialogues[num]) dialogues[num] = {};
                dialogues[num].audioId = file.id;
            }
            if (textMatch) {
                const num = textMatch[1];
                if (!dialogues[num]) dialogues[num] = {};
                dialogues[num].transcriptId = file.id;
            }
        });

        // Only return pairs that have BOTH audio and text
        const result = Object.keys(dialogues)
            .filter(num => dialogues[num].audioId && dialogues[num].transcriptId)
            .sort((a, b) => parseInt(a) - parseInt(b))
            .map(num => ({
                number: num,
                label: `Dialogue ${num}`,
                ...dialogues[num]
            }));

        res.json(result);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// 2. Stream File (Audio or Text)
app.get('/api/file/:fileId', async (req, res) => {
    try {
        const auth = getAuth();
        const drive = google.drive({ version: 'v3', auth });
        
        const result = await drive.files.get(
            { fileId: req.params.fileId, alt: 'media' },
            { responseType: 'stream' }
        );

        // Pipe the stream directly to the response
        result.data.pipe(res);

    } catch (error) {
        console.error(error);
        res.status(500).send('Error streaming file');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});