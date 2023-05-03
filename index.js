//RequireMents
const express = require("express");
require("dotenv").config();
const app = express();
const cors = require("cors");
const mongoose = require("mongoose");
const User = require("./models/Users");
const Post = require("./models/Post");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const { GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");
const cookieSession = require("cookie-session");

//PORT From Env
const PORT = process.env.PORT;
const bucketName = process.env.BUCKET_NAME;
const region = process.env.BUCKET_REGION;
const accessKeyId = process.env.ACCESS_KEY;
const secretAccessKey = process.env.SECRET_S3;

//s3client

const s3Client = new S3Client({
  region,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});
const generateFileName = (bytes = 32) =>
  crypto.randomBytes(bytes).toString("hex");

//Middleware
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });
app.set("trust proxy", 1);
app.use(
  cookieSession({
    name: "session",
    keys: ["cyberwolve"],
    maxAge: 24 * 60 * 60 * 100,
    sameSite: "none",
    secure: true,
    httpOnly: true,
  })
);
app.use(
  cors({
    credentials: true,
    origin: "https://blog-mern-frondend.netlify.app",
    methods: "GET,POST,PUT,DELETE",
  })
);
app.use(express.json());
app.use(cookieParser());

//mongoConnection
mongoose.connect(process.env.MONGO_URL);

//SampleRoute(or)SampleEndPoint
app.get("/", function (request, response) {
  response.send("🙋‍♂️, 🌏 🎊✨🤩");
});

//Login_EndPoint With JWT
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const userFromDB = await getUserByName(username);
  if (!userFromDB) {
    res.status(400).send({ message: "invalid credentials" });
  } else {
    const storedDBPassword = userFromDB.password;
    const isPasswordCheck = await bcrypt.compare(password, storedDBPassword);
    if (isPasswordCheck) {
      const token = jwt.sign(
        { username, id: userFromDB._id },
        process.env.SECRET_KEY
      );
      res
        .status(200)
        .cookie("token", token)
        .json({ id: userFromDB._id, username });
    } else {
      res.status(400).send({ message: "invalid credentials" });
    }
  }
});

//LogOut Function
app.post("/logout", (req, res) => {
  res.status(200).cookie("token", "").json("ok");
});

//Register_EndPoint With HashedPassword
app.post("/register", async (req, res) => {
  const { username, password, email } = req.body;
  const hashedPassword = await generateHashedPass(password);
  try {
    const userDoc = await User.create({
      username,
      password: hashedPassword,
      email,
    });
    res.status(200).json(userDoc);
  } catch (error) {
    res.status(404).json("Something Went worng...");
  }
});

//Checking User Has Valid Cookies
app.get("/profile", (req, res) => {
  const { token } = req.cookies;
  jwt.verify(token, process.env.SECRET_KEY, {}, (err, info) => {
    if (err) {
      res.status(200).json("invalid Token");
    } else {
      res.status(200).json(info);
    }
  });
});
//Get Post
app.get("/post", async (req, res) => {
  const posts = await Post.find()
    .populate("author", ["username"])
    .sort({ createdAt: -1 })
    .limit(20);
  for (let post of posts) {
    const getObjectParams = {
      Bucket: bucketName,
      Key: post.cover,
    };
    const command = new GetObjectCommand(getObjectParams);
    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    post.cover = url;
  }
  res.status(200).json(posts);
});
//Get Particular Post By Id
app.get("/post/:id", async (req, res) => {
  const { id } = req.params;

  const post = await Post.findById(id).populate("author", ["username"]);
  const getObjectParams = {
    Bucket: bucketName,
    Key: post.cover,
  };
  const command = new GetObjectCommand(getObjectParams);
  const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
  post.cover = url;

  res.status(200).json(post);
});

app.get("/edit/:id", async (req, res) => {
  const { id } = req.params;

  const post = await Post.findById(id).populate("author", ["username"]);

  res.status(200).json(post);
});
//Delete Particular Post
app.delete("/post/:id", async (req, res) => {
  const { id } = req.params;

  const { token } = req.cookies;
  jwt.verify(token, process.env.SECRET_KEY, {}, async (err, info) => {
    if (err) throw err;
    const post = await Post.findById(id);
    if (!post) {
      res.status(400).send("no post Found");
      return;
    }
    const isAuthor = JSON.stringify(post.author) === JSON.stringify(info.id);
    if (!isAuthor) {
      return res.status(400).json("you are not the author");
    }
    const deleteObjectParams = {
      Bucket: bucketName,
      Key: post.cover,
    };
    const command = new DeleteObjectCommand(deleteObjectParams);
    await s3Client.send(command);

    await Post.findByIdAndDelete(id);
    res.status(200).json("post Deleted");
  });
});

//create post
app.post("/post", upload.single("image"), async (req, res) => {
  const imageName = generateFileName();
  const params = {
    Bucket: bucketName,
    Key: imageName,
    Body: req.file.buffer,
    ContentType: req.file.mimetype,
  };
  const command = new PutObjectCommand(params);
  await s3Client.send(command);

  const { token } = req.cookies;
  jwt.verify(token, process.env.SECRET_KEY, {}, async (err, info) => {
    if (err) throw err;
    const { title, summary, content } = req.body;
    const postDoc = await Post.create({
      title,
      summary,
      content,
      cover: imageName,
      author: info.id,
    });
    res.json(postDoc);
  });
});
app.put("/edit/:id", upload.single("image"), async (req, res) => {
  const { id } = req.params;
  const { token } = req.cookies;
  jwt.verify(token, process.env.SECRET_KEY, {}, async (err, info) => {
    if (err) throw err;
    const post = await Post.findById(id);
    if (!post) {
      res.status(400).send("no post Found");
      return;
    }
    const isAuthor = JSON.stringify(post.author) === JSON.stringify(info.id);
    if (!isAuthor) {
      return res.status(400).json("you are not the author");
    }
    const { title, summary, content } = req.body;

    const imageName = post.cover;
    const params = {
      Bucket: bucketName,
      Key: imageName,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    };
    const command = new PutObjectCommand(params);
    await s3Client.send(command);
    await post.updateOne({
      title,
      summary,
      content,
      cover: imageName,
      author: info.id,
    });
    res.status(200).json(post);
  });
});

app.put("/post/:id", upload.single("image"), async (req, res) => {
  const { id } = req.params;
  const { token } = req.cookies;
  jwt.verify(token, process.env.SECRET_KEY, {}, async (err, info) => {
    if (err) throw err;
    const post = await Post.findById(id);
    if (!post) {
      res.status(400).send("no post Found");
      return;
    }
    const isAuthor = JSON.stringify(post.author) === JSON.stringify(info.id);
    if (!isAuthor) {
      return res.status(400).json("you are not the author");
    }
    const { title, image, summary, content } = req.body;
    await post.updateOne({
      title,
      summary,
      content,
      cover: image,
      author: info.id,
    });
    res.status(200).json(post);
  });
});

//Listen
app.listen(PORT, () => console.log(`The server started in: ${PORT} ✨✨`));

//hashedpassword
async function generateHashedPass(pass) {
  const NO_OF_ROUNDS = 10;
  const salt = await bcrypt.genSalt(NO_OF_ROUNDS);
  const hashedPassword = await bcrypt.hash(pass, salt);
  return hashedPassword;
}

async function getUserByName(username) {
  return await User.findOne({ username: username });
}
