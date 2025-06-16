const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const path = require('path');
const cors = require('cors');
const Tesseract = require('tesseract.js');
const { fromPath } = require('pdf2pic');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.static('public'));

// Configuración de Multer para manejar el archivo en memoria
const upload = multer({
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Solo se permiten archivos PDF'), false);
        }
    },
    limits: {
        fileSize: 10 * 1024 * 1024 // límite de 10MB
    }
});

// Función para procesar PDF con OCR
async function processPDFWithOCR(pdfBuffer) {
    try {
        // Guardar el buffer temporalmente
        const tempPath = path.join(__dirname, 'temp.pdf');
        require('fs').writeFileSync(tempPath, pdfBuffer);

        // Configurar la conversión
        const convert = fromPath(tempPath, {
            density: 300,
            saveFilename: "temp",
            savePath: __dirname,
            format: "png",
            width: 2000,
            height: 2000
        });

        // Convertir todas las páginas
        const pageToConvertAsImage = 1;
        const pages = await convert.bulk(-1); // -1 significa todas las páginas

        let fullText = '';
        
        // Procesar cada página con OCR
        for (let i = 0; i < pages.length; i++) {
            const { data: { text } } = await Tesseract.recognize(
                pages[i].path,
                'spa', // Idioma español
                {
                    logger: m => console.log(m)
                }
            );
            fullText += `\n--- Página ${i + 1} ---\n${text}`;

            // Limpiar archivo temporal
            require('fs').unlinkSync(pages[i].path);
        }

        // Limpiar archivo PDF temporal
        require('fs').unlinkSync(tempPath);

        return {
            text: fullText,
            numPages: pages.length,
            info: {
                processedWithOCR: true
            }
        };
    } catch (error) {
        console.error('Error en OCR:', error);
        throw error;
    }
}

// Routes
app.post('/upload', upload.single('pdfFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No se ha subido ningún archivo' });
        }

        const dataBuffer = req.file.buffer;
        let result;

        try {
            // Intentar primero con pdf-parse
            const data = await pdfParse(dataBuffer);
            result = {
                text: data.text,
                numPages: data.numpages,
                info: {
                    processedWithOCR: false
                }
            };
        } catch (error) {
            // Si falla, intentar con OCR
            console.log('PDF no es texto digital, intentando con OCR...');
            result = await processPDFWithOCR(dataBuffer);
        }

        res.json(result);
    } catch (error) {
        console.error('Error processing PDF:', error);
        res.status(500).json({ 
            error: 'Error procesando el PDF',
            details: error.message 
        });
    }
});

// Middleware para manejar errores
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'El archivo es demasiado grande' });
        }
        return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Error interno del servidor' });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
