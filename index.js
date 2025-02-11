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

const corsOptions = {
  origin: '*', // Allow all origins
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions)); // Use cors middleware with options

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

// Function to generate PDF content
const generatePdfContent = (userData, groupedAnswers) => `
  <html>
  <head>
    <style>
      body { font-family: Arial, sans-serif; margin: 20px; }
      h1 { color: #4CAF50; }
      p { font-size: 16px; }
      ul { list-style-type: none; padding: 0; }
      li { margin-bottom: 10px; }
      .answer { background: #f9f9f9; padding: 10px; border: 1px solid #ddd; border-radius: 5px; }
      .header { margin-bottom: 20px; }
      .header p { margin: 5px 0; }
      .chapter { margin-top: 20px; }
      .follow-up { font-size: 12px; color: #555; }
      .follow-up-question { display: flex; align-items: center; }
      .follow-up-question .follow-up { margin-right: 10px; }
      .follow-up-label { color: red; font-weight: bold; }
      .footer { margin-top: 40px; text-align: center; font-size: 14px; color: #777; }
    </style>
  </head>
  <body>
    <div class="header">
      <h1>Quiz Results</h1>
      <p><strong>Name:</strong> ${userData.userName}</p>
      <p><strong>Sur Name:</strong> ${userData.userSurname}</p>
      <p><strong>Email:</strong> ${userData.userEmail}</p>
      <p><strong>Total Points:</strong> ${userData.totalPoints}</p>
    </div>
    ${Object.keys(groupedAnswers).map(chapterName => `
      <div class="chapter">
        <h2>${chapterName}</h2>
        <ul>
          ${groupedAnswers[chapterName].map(answer => {
            const question = questionsData.find(q => q.questionText === answer.questionName);
            return `
              <li class="answer">
                ${question.followUp ? `
                  <div class="follow-up-question">
                    <div class="follow-up-label">Follow-up:</div>
                    <div><strong>${answer.questionName}:</strong> ${answer.selectedAnswer} (${answer.points} points)</div>
                  </div>
                ` : `
                  <strong>${answer.questionName}:</strong> ${answer.selectedAnswer} (${answer.points} points)
                `}
              </li>`;
          }).join('')}
        </ul>
      </div>`).join('')}
    <div class="footer">
      <p>Thank you for participating in the quiz!</p>
    </div>
  </body>
  </html>
`;

// Function to send email with PDF attachment
const sendEmailWithPdf = (userEmail, userName, pdfFileName, pdfUrl) => {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: userEmail,
    subject: 'Your Quiz Results',
    html: `
      <div style="font-family: Arial, sans-serif; color: #333;">
        <p>Dear ${userName},</p>
        <p>Thank you for completing the quiz. Please find attached your quiz results.</p>
        <p>Best regards,<br/>Quiz Team</p>
        <footer style="margin-top: 20px; font-size: 12px; color: #777;">
          <p>This is an automated message, please do not reply.</p>
        </footer>
      </div>
    `,
    attachments: [
      {
        filename: pdfFileName,
        path: pdfUrl
      }
    ]
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      return console.log(error);
    }
    console.log('Email sent: ' + info.response);
  });
};

// Endpoint to submit quiz data
app.post('/api/submitUserData', async (req, res) => {
  try {
    const quizData = new Quiz(req.body);

    // Group answers by chapter name
    const groupedAnswers = req.body.answers.reduce((acc, answer) => {
      const chapterName = questionsData.find(q => q.questionText === answer.questionName).chName;
      if (!acc[chapterName]) {
        acc[chapterName] = [];
      }
      acc[chapterName].push(answer);
      return acc;
    }, {});

    // Generate PDF content
    const pdfContent = generatePdfContent(req.body, groupedAnswers);
    const randomValue = Math.floor(1000 + Math.random() * 9000);
    const pdfFileName = `${req.body.userName}_${req.body.userSurname}_${randomValue}.pdf`;

    // Upload PDF to Cloudinary
    pdf.create(pdfContent).toBuffer(async (err, buffer) => {
      if (err) return console.log(err);

      cloudinary.uploader.upload_stream({ resource_type: "raw", public_id: pdfFileName }, async (error, result) => {
        if (error) return console.log(error);

        // Save Cloudinary URL in the database
        quizData.pdfUrl = result.secure_url;
        await quizData.save();

        // Send email with PDF attachment
        sendEmailWithPdf(req.body.userEmail, req.body.userName, pdfFileName, result.secure_url);

        res.status(200).json({
          message: 'Quiz submitted successfully!',
          data: {
            ...quizData.toObject(),
            pdfUrl: result.secure_url // Return Cloudinary URL for the PDF file
          }
        });
      }).end(buffer);
    });
  } catch (error) {
    console.error("Error submitting data:", error);
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
