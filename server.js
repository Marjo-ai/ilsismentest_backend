const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const app = express();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || "drwjmymb3",
  api_key: process.env.CLOUDINARY_API_KEY || "563938733716558",
  api_secret: process.env.CLOUDINARY_API_SECRET || "Z-Kngtn_YYhb8nkJ_kPMuvjXmr8"
});

app.use(cors({
  origin: '*', // Or replace with 'http://localhost:3000' for specific origin
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Authorization', 'X-User-Role', 'Content-Type']
}));
// Konfigurimi i Express për të trajtuar JSON dhe skedarët statikë

app.use(express.json());
app.use(express.static('.'));

// Konfigurimi i CORS për të lejuar kërkesat nga çdo origjinë (për testim)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Authorization, X-User-Role, Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  next();
});

// Konfigurimi i multer për ngarkimin e skedarëve
const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const filetypes = /svg|png/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Skedari duhet të jetë SVG ose PNG.'));
  }
});

// Inicializimi i drejtorive për ruajtjen e skedarëve
async function initializeDirectories() {
  try {
    await fs.mkdir('masterplans', { recursive: true });
    await fs.mkdir('planimetrite', { recursive: true });
    await fs.mkdir('renders', { recursive: true });
    await fs.mkdir('floorplans', { recursive: true });
    console.log('Drejtoriat u inicializuan me sukses.');
  } catch (error) {
    console.error('Gabim gjatë inicializimit të drejtorive:', error);
  }
}
initializeDirectories();

// Funksione ndihmëse për menaxhimin e skedarëve JSON
async function readJsonFile(filePath, defaultValue = {}) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      await fs.writeFile(filePath, JSON.stringify(defaultValue), 'utf8');
      return defaultValue;
    }
    throw error;
  }
}

async function writeJsonFile(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// Lista e përdoruesve të autorizuar si Editor
const ALLOWED_EDITORS = {
  "Marjo Naci": "MarjoNaci",
  "Eduard Duka": "EduardDuka",
  "Ilir Shameti": "IlirShameti"
};

// Middleware për verifikimin e autentikimit
const authenticate = (req, res, next) => {
  const authToken = req.headers['authorization'];
  const expectedToken = 'super-secret-token';
  console.log('Token i marrë:', authToken); // Log për debugging

  if (!authToken || authToken !== expectedToken) {
    return res.status(401).json({ success: false, error: 'E paautorizuar: Token i pavlefshëm ose mungon' });
  }

  next();
};

// Middleware për kufizimin e veprimeve për Vizitorët
const restrictVisitors = (req, res, next) => {
  const role = req.headers['x-user-role'];
  console.log('Roli i përdoruesit:', role); // Log për debugging
  if (role === 'visitor' && (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE')) {
    return res.status(403).json({ success: false, error: 'Vetëm Editorët mund të bëjnë ndryshime.' });
  }
  next();
};

// Endpoint për autentikimin e përdoruesve
app.post('/login', async (req, res) => {
  const { role, username, password } = req.body;
  console.log('Kërkesë për login:', { role, username });

  if (!role) {
    return res.status(400).json({ success: false, error: 'Roli është i detyrueshëm' });
  }

  if (role === 'editor') {
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Emri i përdoruesit dhe fjalëkalimi janë të detyrueshme për rolin Editor' });
    }
    if (!ALLOWED_EDITORS[username] || ALLOWED_EDITORS[username] !== password) {
      return res.status(401).json({ success: false, error: 'Emër përdoruesi ose fjalëkalim i pavlefshëm për rolin Editor' });
    }
  }

  const token = 'super-secret-token';
  res.json({ success: true, token });
});

// Endpoint për marrjen e listës së projekteve
app.get('/projects', authenticate, async (req, res) => {
  console.log('Kërkesë për /projects');
  const projects = await readJsonFile('projects.json', []);
  res.json(projects);
});

// Endpoint për shtimin e një projekti të ri
app.post('/projects', authenticate, restrictVisitors, upload.single('masterplan'), async (req, res) => {
  try {
    console.log('Kërkesë për /projects POST:', req.body, req.file);
    const { name, numberOfBuildings } = req.body;
    if (!name || !req.file || !numberOfBuildings) {
      return res.status(400).json({ success: false, error: 'Fushat e detyrueshme mungojnë' });
    }

    // Upload to Cloudinary
    const uploadPromise = new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'masterplans',
          resource_type: 'auto'
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      uploadStream.end(req.file.buffer);
    });

    const result = await uploadPromise;

    const projects = await readJsonFile('projects.json', []);
    const projectId = projects.length ? Math.max(...projects.map(p => p.id)) + 1 : 1;
    const newProject = {
      id: projectId,
      name,
      masterplan: result.secure_url, // Store the Cloudinary URL
      numberOfBuildings: parseInt(numberOfBuildings),
      buildings: Array.from({ length: parseInt(numberOfBuildings) }, (_, i) => ({
        id: `Pallati ${i + 1}`,
        floors: 0,
        render: null
      }))
    };
    projects.push(newProject);
    await writeJsonFile('projects.json', projects);

    await writeJsonFile(`apartments_project${projectId}.json`, {});
    await writeJsonFile(`floorplans_project${projectId}.json`, {});

    res.json({ success: true });
  } catch (error) {
    console.error('Gabim gjatë shtimit të projektit:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint për fshirjen e një projekti
app.delete('/projects/:projectId', authenticate, restrictVisitors, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const apartmentsFilePath = path.join(__dirname, `apartments_project${projectId}.json`);
  const floorplansFilePath = path.join(__dirname, `floorplans_project${projectId}.json`);

  try {
    console.log(`Kërkesë për fshirje projekti ${projectId}`);
    const projects = await readJsonFile('projects.json', []);
    const projectIndex = projects.findIndex(p => p.id === projectId);
    if (projectIndex === -1) {
      return res.status(404).json({ success: false, error: 'Projekti nuk u gjet' });
    }

    const project = projects[projectIndex];

    try {
      await fs.unlink(path.join(__dirname, project.masterplan));
    } catch (err) {
      console.warn(`Dështoi fshirja e skedarit të masterplanit ${project.masterplan}: ${err.message}`);
    }

    for (const building of project.buildings) {
      if (building.render) {
        try {
          await fs.unlink(path.join(__dirname, building.render));
        } catch (err) {
          console.warn(`Dështoi fshirja e skedarit të render-it ${project.render}: ${err.message}`);
        }
      }
    }

    try {
      const apartments = await readJsonFile(apartmentsFilePath, {});
      for (const buildingId in apartments) {
        for (const floor in apartments[buildingId]) {
          for (const apt of apartments[buildingId][floor]) {
            try {
              await fs.unlink(path.join(__dirname, apt.plan));
              if (apt.redFloorPlan) await fs.unlink(path.join(__dirname, apt.redFloorPlan));
              if (apt.greenFloorPlan) await fs.unlink(path.join(__dirname, apt.greenFloorPlan));
            } catch (err) {
              console.warn(`Dështoi fshirja e skedarit të planit ${apt.plan}: ${err.message}`);
            }
          }
        }
      }
      await fs.unlink(apartmentsFilePath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    try {
      const floorplans = await readJsonFile(floorplansFilePath, {});
      for (const buildingId in floorplans) {
        for (const floor in floorplans[buildingId]) {
          try {
            await fs.unlink(path.join(__dirname, floorplans[buildingId][floor].plan));
          } catch (err) {
            console.warn(`Dështoi fshirja e skedarit të planimetrisë ${floorplans[buildingId][floor].plan}: ${err.message}`);
          }
        }
      }
      await fs.unlink(floorplansFilePath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    projects.splice(projectIndex, 1);
    await writeJsonFile('projects.json', projects);

    res.json({ success: true });
  } catch (error) {
    console.error('Gabim gjatë fshirjes së projektit:', error);
    res.status(500).json({ success: false, error: 'Dështoi fshirja e projektit' });
  }
});

// Endpoint për përditësimin e një projekti
app.put('/projects/:projectId', authenticate, restrictVisitors, async (req, res) => {
  try {
    console.log(`Kërkesë për përditësim projekti ${req.params.projectId}`);
    const projectId = parseInt(req.params.projectId);
    const projects = await readJsonFile('projects.json', []);
    const projectIndex = projects.findIndex(p => p.id === projectId);
    if (projectIndex === -1) {
      return res.status(404).json({ success: false, error: 'Projekti nuk u gjet' });
    }

    projects[projectIndex] = { ...projects[projectIndex], ...req.body };
    await writeJsonFile('projects.json', projects);
    res.json({ success: true });
  } catch (error) {
    console.error('Gabim gjatë përditësimit të projektit:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint për ngarkimin e render-it të një pallati
app.post('/projects/:projectId/render', authenticate, restrictVisitors, upload.single('render'), async (req, res) => {
  try {
    console.log(`Kërkesë për ngarkim render për projektin ${req.params.projectId}`);
    const projectId = parseInt(req.params.projectId);
    const { buildingId } = req.body;
    if (!buildingId || !req.file) {
      return res.status(400).json({ success: false, error: 'Mungon ID e pallatit ose skedari i render-it' });
    }

    const projects = await readJsonFile('projects.json', []);
    const projectIndex = projects.findIndex(p => p.id === projectId);
    if (projectIndex === -1) {
      return res.status(404).json({ success: false, error: 'Projekti nuk u gjet' });
    }

    const project = projects[projectIndex];
    const buildingIndex = project.buildings.findIndex(b => b.id === buildingId);
    if (buildingIndex === -1) {
      return res.status(404).json({ success: false, error: 'Pallati nuk u gjet' });
    }

    const oldRender = project.buildings[buildingIndex].render;
    if (oldRender) {
      try {
        await fs.unlink(path.join(__dirname, oldRender));
      } catch (err) {
        console.warn(`Dështoi fshirja e skedarit të vjetër të render-it ${oldRender}: ${err.message}`);
      }
    }

    project.buildings[buildingIndex].render = `renders/${req.file.filename}`;
    await writeJsonFile('projects.json', projects);
    res.json({ success: true });
  } catch (error) {
    console.error('Gabim gjatë ngarkimit të render-it:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint për shtimin e një pallati të ri
app.post('/projects/:projectId/building', authenticate, restrictVisitors, upload.single('render'), async (req, res) => {
  try {
    console.log(`Kërkesë për shtim pallati në projektin ${req.params.projectId}`);
    const projectId = parseInt(req.params.projectId);
    const { buildingId, floors } = req.body;

    if (!buildingId || floors === undefined || !req.file) {
      return res.status(400).json({ success: false, error: 'Mungon ID e pallatit, numri i kateve, ose skedari i render-it' });
    }

    const projects = await readJsonFile('projects.json', []);
    const projectIndex = projects.findIndex(p => p.id === projectId);
    if (projectIndex === -1) {
      return res.status(404).json({ success: false, error: 'Projekti nuk u gjet' });
    }

    const project = projects[projectIndex];
    if (project.buildings.some(b => b.id === buildingId)) {
      return res.status(400).json({ success: false, error: 'ID e pallatit ekziston tashmë në këtë projekt' });
    }

    project.buildings.push({
      id: buildingId,
      floors: parseInt(floors),
      render: `renders/${req.file.filename}`
    });

    project.numberOfBuildings = project.buildings.length;

    await writeJsonFile('projects.json', projects);
    res.json({ success: true });
  } catch (error) {
    console.error('Gabim gjatë shtimit të pallatit:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint për fshirjen e një pallati
app.delete('/projects/:projectId/building/:buildingId', authenticate, restrictVisitors, async (req, res) => {
  try {
    console.log(`Kërkesë për fshirje pallati ${req.params.buildingId} nga projekti ${req.params.projectId}`);
    const projectId = parseInt(req.params.projectId);
    const buildingId = req.params.buildingId;
    const projects = await readJsonFile('projects.json', []);
    const projectIndex = projects.findIndex(p => p.id === projectId);
    if (projectIndex === -1) {
      return res.status(404).json({ success: false, error: 'Projekti nuk u gjet' });
    }

    const project = projects[projectIndex];
    const buildingIndex = project.buildings.findIndex(b => b.id === buildingId);
    if (buildingIndex === -1) {
      return res.status(404).json({ success: false, error: 'Pallati nuk u gjet' });
    }

    const building = project.buildings[buildingIndex];
    if (building.render) {
      try {
        await fs.unlink(path.join(__dirname, building.render));
      } catch (err) {
        console.warn(`Dështoi fshirja e skedarit të render-it ${building.render}: ${err.message}`);
      }
    }

    project.buildings.splice(buildingIndex, 1);
    project.numberOfBuildings = project.buildings.length;
    await writeJsonFile('projects.json', projects);

    const apartments = await readJsonFile(`apartments_project${projectId}.json`, {});
    if (apartments[buildingId]) {
      for (const floor in apartments[buildingId]) {
        for (const apt of apartments[buildingId][floor]) {
          if (apt.plan) {
            try {
              await fs.unlink(path.join(__dirname, apt.plan));
              if (apt.redFloorPlan) await fs.unlink(path.join(__dirname, apt.redFloorPlan));
              if (apt.greenFloorPlan) await fs.unlink(path.join(__dirname, apt.greenFloorPlan));
            } catch (err) {
              console.warn(`Dështoi fshirja e skedarit ${apt.plan}:`, err);
            }
          }
        }
      }
      delete apartments[buildingId];
      await writeJsonFile(`apartments_project${projectId}.json`, apartments);
    }

    const floorplans = await readJsonFile(`floorplans_project${projectId}.json`, {});
    if (floorplans[buildingId]) {
      for (const floor in floorplans[buildingId]) {
        try {
          await fs.unlink(path.join(__dirname, floorplans[buildingId][floor].plan));
        } catch (err) {
          console.warn(`Dështoi fshirja e skedarit të planimetrisë ${floorplans[buildingId][floor].plan}: ${err.message}`);
        }
      }
      delete floorplans[buildingId];
      await writeJsonFile(`floorplans_project${projectId}.json`, floorplans);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Gabim gjatë fshirjes së pallatit:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint për marrjen e apartamenteve të një projekti
app.get('/apartments/:projectId', authenticate, async (req, res) => {
  console.log(`Kërkesë për apartamentet e projektit ${req.params.projectId}`);
  const projectId = req.params.projectId;
  const apartments = await readJsonFile(`apartments_project${projectId}.json`, {});
  res.json(apartments);
});

// Endpoint për shtimin e një apartamenti
app.post('/apartments/:projectId', authenticate, restrictVisitors, upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'redFloorPlan', maxCount: 1 },
  { name: 'greenFloorPlan', maxCount: 1 }
]), async (req, res) => {
  try {
    console.log(`Kërkesë për shtim apartamenti në projektin ${req.params.projectId}`, req.body, req.files);
    const projectId = req.params.projectId;
    const { aptId, status, floor, buildingId } = req.body;

    if (!req.files || !req.files['file'] || !req.files['redFloorPlan'] || !req.files['greenFloorPlan']) {
      return res.status(400).json({ success: false, error: 'Të gjitha skedarët (planimetria e apartamentit, planimetria e kuqe, planimetria jeshile) janë të detyrueshme' });
    }

    const filePath = `planimetrite/${req.files['file'][0].filename}`;
    const redFloorPlanPath = `floorplans/${req.files['redFloorPlan'][0].filename}`;
    const greenFloorPlanPath = `floorplans/${req.files['greenFloorPlan'][0].filename}`;

    console.log(`Apartamenti u ruajt në ${filePath}`);
    console.log(`Planimetria e kuqe u ruajt në ${redFloorPlanPath}`);
    console.log(`Planimetria jeshile u ruajt në ${greenFloorPlanPath}`);

    const apartments = await readJsonFile(`apartments_project${projectId}.json`, {});
    if (!apartments[buildingId]) {
      apartments[buildingId] = {};
    }
    if (!apartments[buildingId][floor]) {
      apartments[buildingId][floor] = [];
    }

    if (apartments[buildingId][floor].some(apt => apt.id === aptId)) {
      return res.status(400).json({ success: false, error: 'ID e apartamentit ekziston tashmë në këtë kat' });
    }

    apartments[buildingId][floor].push({
      id: aptId,
      status,
      plan: filePath,
      redFloorPlan: redFloorPlanPath,
      greenFloorPlan: greenFloorPlanPath
    });

    await writeJsonFile(`apartments_project${projectId}.json`, apartments);
    res.json({
      success: true,
      filePath,
      redFloorPlanPath,
      greenFloorPlanPath
    });
  } catch (error) {
    console.error('Gabim gjatë shtimit të apartamentit:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint për përditësimin e apartamenteve
app.put('/apartments/:projectId', authenticate, restrictVisitors, async (req, res) => {
  try {
    console.log(`Kërkesë për përditësim apartamentesh në projektin ${req.params.projectId}`);
    const projectId = req.params.projectId;
    await writeJsonFile(`apartments_project${projectId}.json`, req.body);
    res.json({ success: true });
  } catch (error) {
    console.error('Gabim gjatë përditësimit të apartamenteve:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint për fshirjen e një apartamenti
app.delete('/apartments/:projectId', authenticate, restrictVisitors, async (req, res) => {
  try {
    console.log(`Kërkesë për fshirje apartamenti nga projekti ${req.params.projectId}`, req.body);
    const projectId = req.params.projectId;
    const { aptId, floor, filePath, redFloorPlanPath, greenFloorPlanPath, buildingId } = req.body;

    const apartments = await readJsonFile(`apartments_project${projectId}.json`, {});
    if (apartments[buildingId] && apartments[buildingId][floor]) {
      const aptIndex = apartments[buildingId][floor].findIndex(apt => apt.id === aptId);
      if (aptIndex !== -1) {
        apartments[buildingId][floor].splice(aptIndex, 1);
        if (apartments[buildingId][floor].length === 0) {
          delete apartments[buildingId][floor];
        }
        if (Object.keys(apartments[buildingId]).length === 0) {
          delete apartments[buildingId];
        }
        await writeJsonFile(`apartments_project${projectId}.json`, apartments);

        if (filePath) {
          try {
            await fs.unlink(path.join(__dirname, filePath));
            console.log(`Skedari i apartamentit ${filePath} u fshi.`);
          } catch (err) {
            console.warn(`Dështoi fshirja e skedarit ${filePath}:`, err);
          }
        }
        if (redFloorPlanPath) {
          try {
            await fs.unlink(path.join(__dirname, redFloorPlanPath));
            console.log(`Skedari i planimetrisë së kuqe ${redFloorPlanPath} u fshi.`);
          } catch (err) {
            console.warn(`Dështoi fshirja e skedarit ${redFloorPlanPath}:`, err);
          }
        }
        if (greenFloorPlanPath) {
          try {
            await fs.unlink(path.join(__dirname, greenFloorPlanPath));
            console.log(`Skedari i planimetrisë jeshile ${greenFloorPlanPath} u fshi.`);
          } catch (err) {
            console.warn(`Dështoi fshirja e skedarit ${greenFloorPlanPath}:`, err);
          }
        }

        res.json({ success: true });
      } else {
        res.status(404).json({ success: false, error: 'Apartamenti nuk u gjet' });
      }
    } else {
      res.status(404).json({ success: false, error: 'Kati ose pallati nuk u gjet' });
    }
  } catch (error) {
    console.error('Gabim gjatë fshirjes së apartamentit:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint për marrjen e planimetrive të një projekti
app.get('/floorplans/:projectId', authenticate, async (req, res) => {
  console.log(`Kërkesë për planimetritë e projektit ${req.params.projectId}`);
  const projectId = req.params.projectId;
  const floorplans = await readJsonFile(`floorplans_project${projectId}.json`, {});
  res.json(floorplans);
});

// Endpoint për ngarkimin ose zëvendësimin e planimetrisë së një kati
app.post('/floorplans/:projectId', authenticate, restrictVisitors, upload.single('file'), async (req, res) => {
  try {
    console.log(`Kërkesë për ngarkim planimetrie për projektin ${req.params.projectId}`, req.body, req.file);
    const projectId = req.params.projectId;
    const { floor, buildingId } = req.body;

    if (!floor || !buildingId || !req.file) {
      return res.status(400).json({ success: false, error: 'Mungon kati, ID e pallatit, ose skedari i planimetrisë' });
    }

    const floorplans = await readJsonFile(`floorplans_project${projectId}.json`, {});
    if (!floorplans[buildingId]) {
      floorplans[buildingId] = {};
    }

    // Fshirja e skedarit të vjetër të planimetrisë, nëse ekziston
    if (floorplans[buildingId][floor]) {
      try {
        await fs.unlink(path.join(__dirname, floorplans[buildingId][floor].plan));
        console.log(`Skedari i vjetër i planimetrisë ${floorplans[buildingId][floor].plan} u fshi.`);
      } catch (err) {
        console.warn(`Dështoi fshirja e skedarit të vjetër të planimetrisë ${floorplans[buildingId][floor].plan}: ${err.message}`);
      }
    }

    const filePath = `floorplans/${req.file.filename}`;
    floorplans[buildingId][floor] = { plan: filePath };
    await writeJsonFile(`floorplans_project${projectId}.json`, floorplans);
    console.log(`Planimetria u ruajt në ${filePath}`);
    res.json({ success: true, filePath });
  } catch (error) {
    console.error('Gabim gjatë ngarkimit/zëvendësimit të planimetrisë:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint për fshirjen e planimetrisë së një kati
app.delete('/floorplans/:projectId', authenticate, restrictVisitors, async (req, res) => {
  try {
    console.log(`Kërkesë për fshirje planimetrie nga projekti ${req.params.projectId}`, req.body);
    const projectId = req.params.projectId;
    const { floor, buildingId } = req.body;

    if (!floor || !buildingId) {
      return res.status(400).json({ success: false, error: 'Mungon kati ose ID e pallatit' });
    }

    const floorplans = await readJsonFile(`floorplans_project${projectId}.json`, {});
    if (!floorplans[buildingId] || !floorplans[buildingId][floor]) {
      return res.status(404).json({ success: false, error: 'Planimetria nuk u gjet' });
    }

    const filePath = floorplans[buildingId][floor].plan;
    try {
      await fs.unlink(path.join(__dirname, filePath));
      console.log(`Skedari i planimetrisë ${filePath} u fshi.`);
    } catch (err) {
      console.warn(`Dështoi fshirja e skedarit të planimetrisë ${filePath}: ${err.message}`);
    }

    delete floorplans[buildingId][floor];
    if (Object.keys(floorplans[buildingId]).length === 0) {
      delete floorplans[buildingId];
    }

    await writeJsonFile(`floorplans_project${projectId}.json`, floorplans);
    res.json({ success: true });
  } catch (error) {
    console.error('Gabim gjatë fshirjes së planimetrisë:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Middleware për trajtimin e gabimeve
app.use((err, req, res, next) => {
  console.error('Gabim i serverit:', err);
  res.status(500).json({ success: false, error: 'Ndodhi një gabim në server: ' + err.message });
});

// Middleware për rrugët që nuk gjenden
app.use((req, res) => {
  console.log(`Kërkesë për endpoint të panjohur: ${req.method} ${req.url}`);
  res.status(404).json({ success: false, error: 'Endpoint nuk u gjet' });
});

// Nisja e serverit
app.listen(3000, () => {
  console.log('Serveri po funksionon në http://localhost:3000');
});