const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const pdf = require('html-pdf');
const fs = require('fs');
const path = require('path');
const cors = require('cors'); // Import cors
const cloudinary = require('cloudinary').v2; // Import Cloudinary
require('dotenv').config();

const app = express();
app.use(bodyParser.json());
app.use(cors()); // Add this line to enable CORS for all origins

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// MongoDB connection
mongoose.connect(process.env.DATABASE_URI, { useNewUrlParser: true, useUnifiedTopology: true });

const quizSchema = new mongoose.Schema({
  userName: String,
  userEmail: String,
  userSurname: String,
  answers: Array,
  totalPoints: Number,
  pdfUrl: String // Add pdfUrl field to schema
});

const Quiz = mongoose.model('Quiz', quizSchema);

const questionsData = require('./qustions.json'); // Import questions data

// Endpoint to submit quiz data

app.post('/api/submitUserData', async (req, res) => {
  try {
    const quizData = new Quiz(req.body);
    await quizData.save();

    const groupedAnswers = req.body.answers.reduce((acc, answer) => {
      const chapterName = questionsData.find(q => q.questionText === answer.questionName).chName;
      if (!acc[chapterName]) acc[chapterName] = [];
      acc[chapterName].push(answer);
      return acc;
    }, {});

    const pdfContent = `
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          h1 { color: #4CAF50; }
          p { font-size: 16px; }
        </style>
      </head>
      <body>
        <h1>Quiz Results</h1>
        <p><strong>Name:</strong> ${req.body.userName}</p>
        <p><strong>Sur Name:</strong> ${req.body.userSurname}</p>
        <p><strong>Email:</strong> ${req.body.userEmail}</p>
        <p><strong>Total Points:</strong> ${req.body.totalPoints}</p>
        ${Object.keys(groupedAnswers).map(chapterName => `
          <h2>${chapterName}</h2>
          <ul>
            ${groupedAnswers[chapterName].map(answer => `
              <li><strong>${answer.questionName}:</strong> ${answer.selectedAnswer} (${answer.points} points)</li>
            `).join('')}
          </ul>
        `).join('')}
      </body>
      </html>
    `;

    const pdfFileName = `${req.body.userName}_${req.body.userSurname}_${Date.now()}.pdf`;

    pdf.create(pdfContent).toBuffer(async (err, buffer) => {
      if (err) return res.status(500).send('Error generating PDF');

      cloudinary.uploader.upload_stream({ resource_type: "raw", public_id: pdfFileName }, async (error, result) => {
        if (error) return res.status(500).send('Error uploading PDF');

        quizData.pdfUrl = result.secure_url;
        await quizData.save();

        res.status(200).json({ message: 'Quiz submitted successfully!', data: quizData });
      }).end(buffer);
    });
  } catch (error) {
    res.status(500).send('Failed to submit quiz.');
  }
});

app.get('/api/getAllSubmissions', async (req, res) => {
  try {
    const submissions = await Quiz.find();
    res.status(200).json(submissions);
  } catch (error) {
    console.error("Error retrieving submissions:", error);
    res.status(500).send('Failed to retrieve submissions.');
  }
});
app.listen(5000, () => {
  console.log('Server is running on port 5000');
});
