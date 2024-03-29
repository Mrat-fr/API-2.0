const express = require("express");
const app = express();
const path = require("path");
const fs = require('fs');
const { createCanvas, loadImage } = require("canvas");
require('dotenv').config();

app.listen(4000, process.env.IP, function(){console.log(`Server is running on port 4000`);});
app.use(express.urlencoded({ extended: false }));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static("public"));
app.use("/Temp/", express.static("./Temp"));
app.use("/ArchiveImage/", express.static("./ArchiveImage"));

//functions------------------------------------------------------------------------
var Animals = ReadAnimals();
function ReadAnimals() {
    const lines = fs.readFileSync('Animals.txt', 'utf-8').split(/\r?\n/);
    return lines;
}

function ReadTemp(){
  var files = []
  fs.readdirSync('./Temp/').forEach(file => {
    let info = {
      filename: file,
      fileloc: './Temp/' + file,
    };
    files.push(info)
  });
  return files;
}

function DeleteTemp(){
  fs.readdir('./Temp/', (err, files) => {
    if (err) throw err;

    for (const file of files) {
      fs.unlink(path.join('./Temp/', file), (err) => {
        if (err) throw err;
      });
    }
  });
}

function DeleteArchive(){
  fs.readdir('./ArchiveImage/', (err, files) => {
    if (err) throw err;

    for (const file of files) {
      fs.unlink(path.join('./ArchiveImage/', file), (err) => {
        if (err) throw err;
      });
    }
  });
}

//storage--------------------------------------------------------------------------
const multer = require('multer');
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'Temp')
  },
  filename: (req, file, cb) => {
    //console.log(file);
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({storage: storage})

//Database-------------------------------------------------------------------------
const sqlite3 = require("sqlite3").verbose();
let db = new sqlite3.Database("./Database.db", sqlite3.OPEN_READWRITE, (err) => {
    if (err) {
      console.error(err.message);
    }
    console.log("Connected to Database.");
});

function DeleteInfo() {
  db.run("DELETE FROM Image",function (err) {
    if (err){return console.log(err.message);}
  }); 
  db.run("DELETE FROM Label",function (err) {
    if (err){return console.log(err.message);}
  }); 
  db.run("UPDATE sqlite_sequence SET seq = '0' WHERE name = 'Image'",function (err) {
    if (err){return console.log(err.message);}
  }); 
  db.run("UPDATE sqlite_sequence SET seq = '0' WHERE name = 'Label'",function (err) {
    if (err){return console.log(err.message);}
  }); 
}

//Pages----------------------------------------------------------------------------
app.get("/", (req, res) => { 
  DeleteTemp();
  res.render("MainPage");
});

app.get("/clear", (req, res) => { 
  DeleteInfo();
  DeleteTemp();
  DeleteArchive();
  res.redirect("/");
});

app.get("/About", (req, res) => { 
  DeleteTemp();
  res.render("About");
});

app.get("/Archive", (req, res) => { 
  DeleteTemp();

  fs.readdirSync('./ArchiveImage/', (err, files) => {
    if (err) throw err;
    for (const file of files) {
      fs.unlink(path.join('./ArchiveImage/', file), (err) => {
        if (err) throw err;
      });
    }
  });

  

  db.all("SELECT * FROM Image", (err, rows) => {
    if (err) {console.error(err.message);}

    rows.forEach((row) => {
      fs.writeFileSync("ArchiveImage/" + row.ImageName, row.Image,"binary",(err) => {
        if (err) {console.error(err.message);}
      });

      fs.writeFileSync("ArchiveImage/Box" + row.ImageName, row.ImageObject,"binary",(err) => {
        if (err) {console.error(err.message);}
      });
    });
  });

  Images = [];

  fs.readdirSync('./ArchiveImage/').forEach(file => {
    if(!file.includes("Box")){
      let info = {filename: file, fileloc: './ArchiveImage/' + file, Boxloc: './ArchiveImage/Box' + file};
      Images.push(info)
    }
  });


  db.all("SELECT * FROM Label", (err, rows) => {
    if (err) {console.error(err.message);}
    var Lables = [];

    rows.forEach(row => {
      var Lay = {Lable: row.Label, Confidence: row.Confidence, ImageName: row.ImageName};
      Lables.push(Lay);
    });

    res.render("Archive", {ImageArray: Images, LableArray: Lables});
  });



});


app.get("/comments", (req, res) => { 
  DeleteTemp();
  res.render("comments");
});

var orgiinalfilelength = 0;
app.post("/upload", upload.array("filetoupload") ,(req, res) => { 
  var files = ReadTemp();
  orgiinalfilelength = files.length;

  files.forEach((file) => {
    localizeObjects(file);
  });
  
  files.forEach((file) => {
    labelDetection(file)
  });

  res.render("upload");
});

app.get("/Results", (req, res) => { 
  var filesdif = ReadTemp();
  showfiles = [];
  filesdif.forEach((file) => {
    fname = file.filename;
    if (fname.includes("Box")){
      showfiles.push(file.fileloc)
    }
  });

  newfiles = filesdif.length;
  diffiles = newfiles - orgiinalfilelength
  wrongfiles = Math.abs(diffiles - orgiinalfilelength)

  var message = null;
  if(wrongfiles != 0){
    message = "There where "+wrongfiles+" Image that did not contain Animals";
  }

  filesdif.forEach((file) => {
    bname = "Box" + file.filename;
    fname = file.filename;
    if (!fname.includes("Box")){
      const simage = fs.readFileSync(file.fileloc);
      const simageBuffer = Buffer.from(simage, "binary");
      const sobjectloc = './Temp/Box' + file.filename;
      const simageo = fs.readFileSync(sobjectloc);
      const simageBuffero = Buffer.from(simageo, "binary");
      db.run("INSERT INTO Image (Image, ImageObject, ImageName) VALUES (?, ?, ?)",[simageBuffer,simageBuffero,file.filename],function (err) {
        if (err){return console.log(err.message);}
      });  
    }
  });

  res.render("Results", { Boximage: showfiles, errormes: message});
});
//API------------------------------------------------------------------------------
const vision = require("@google-cloud/vision");

const client = new vision.ImageAnnotatorClient({
  type:  process.env.type,
  project_id:  process.env.project_id,
  private_key_id:  process.env.private_key_id,
  private_key:  process.env.private_key,
  client_email:  process.env.client_email,
  client_id:  process.env.client_id,
  auth_uri:  process.env.auth_uri,
  token_uri:  process.env.token_uri,
  auth_provider_x509_cert_url:  process.env.auth_provider_x509_cert_url,
  client_x509_cert_url:  process.env.client_x509_cert_url,
});

async function localizeObjects(file) {
  const request = { image: { content: fs.readFileSync(file.fileloc) } };

  const [result] = await client.objectLocalization(request);
  const objects = result.localizedObjectAnnotations;

  var objectlable = [];

  var objectdetails = [];

  objects.forEach((object) => {
    coordinates = [];
    const vertices = object.boundingPoly.normalizedVertices;

    vertices.forEach((v) => coordinates.push(v.x * 1, v.y * 1));

    objectlable.push(object.name);

    let cobject = {name: object.name, coord1x: coordinates[0], coord1y: coordinates[1], coord2x: coordinates[2], coord2y: coordinates[3], coord3x: coordinates[4], coord3y: coordinates[5], coord4x: coordinates[6], coord4y: coordinates[7],};

    objectdetails.push(cobject);
  });

  found = objectlable.some((r) => Animals.indexOf(r) >= 0);
  if (found === false) {
    fs.unlinkSync(file.fileloc)
    return;
  }

  loadImage(file.fileloc).then((image) => {
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d");

    ctx.drawImage(image, 0, 0, image.width, image.height);

    ctx.strokeStyle = "#ff0000";
    ctx.lineWidth = 4;
    ctx.font = "30px Arial";

    objectdetails.forEach((object) => {
      ctx.beginPath();
      ctx.moveTo(object.coord1x * image.width, object.coord1y * image.height);
      ctx.lineTo(object.coord2x * image.width, object.coord2y * image.height);
      ctx.lineTo(object.coord3x * image.width, object.coord3y * image.height);
      ctx.lineTo(object.coord4x * image.width, object.coord4y * image.height);
      ctx.closePath();
      ctx.strokeStyle = "red";
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.font = "bold 40px Arial";
      ctx.fillStyle = "red";
      ctx.fillText(object.name, object.coord1x * image.width, object.coord1y * image.height - 10);
    });

    const out = fs.createWriteStream("Temp/Box" + file.filename);
    const stream = canvas.createJPEGStream();
    stream.pipe(out);
  });
}

async function labelDetection(file) {

  const [result] = await client.labelDetection(file.fileloc);
  const labels = result.labelAnnotations;

  var path = './Temp/Box' + file.filename;
  if (!fs.existsSync(path)) {return}

  labels.forEach((label) => {
    db.run("INSERT INTO Label (Label, Confidence, ImageName) VALUES (?, ?, ?)",[label.description,Math.round(label.score * 100),file.filename])
  })
}