const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const { PDFDocument, rgb } = require('pdf-lib'); // Replace puppeteer with pdf-lib
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

// Function to generate PDF content using pdf-lib
const generatePdfContent = async (userData, groupedAnswers) => {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage();
  const { width, height } = page.getSize();
  const fontSize = 12;

  page.drawText(`Quiz Results`, { x: 50, y: height - 50, size: 24, color: rgb(0.29, 0.63, 0.27) });
  page.drawText(`Name: ${userData.userName}`, { x: 50, y: height - 80, size: fontSize });
  page.drawText(`Sur Name: ${userData.userSurname}`, { x: 50, y: height - 100, size: fontSize });
  page.drawText(`Email: ${userData.userEmail}`, { x: 50, y: height - 120, size: fontSize });
  page.drawText(`Total Points: ${userData.totalPoints}`, { x: 50, y: height - 140, size: fontSize });

  let yPosition = height - 160;
  for (const chapterName of Object.keys(groupedAnswers)) {
    page.drawText(chapterName, { x: 50, y: yPosition, size: 18 });
    yPosition -= 20;

    for (const answer of groupedAnswers[chapterName]) {
      const question = questionsData.find(q => q.questionText === answer.questionName);
      const answerText = question.followUp
        ? `Follow-up: ${answer.questionName}: ${answer.selectedAnswer} (${answer.points} points)`
        : `${answer.questionName}: ${answer.selectedAnswer} (${answer.points} points)`;

      page.drawText(answerText, { x: 50, y: yPosition, size: fontSize });
      yPosition -= 20;
    }
    yPosition -= 20;
  }

  page.drawText(`Thank you for participating in the quiz!`, { x: 50, y: yPosition, size: fontSize, color: rgb(0.47, 0.47, 0.47) });

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
};

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
    const pdfBytes = await generatePdfContent(req.body, groupedAnswers);
    const randomValue = Math.floor(1000 + Math.random() * 9000);
    const pdfFileName = `${req.body.userName}_${req.body.userSurname}_${randomValue}.pdf`;

    // Upload PDF to Cloudinary
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
    }).end(pdfBytes);
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
