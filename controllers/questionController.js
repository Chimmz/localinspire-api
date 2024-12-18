const fs = require('fs');
const mongoose = require('mongoose');

const Business = require('../models/Business');
const BusinessReview = require('../models/BusinessReview');
const BusinessQuestion = require('../models/BusinessQuestion');
const BusinessAnswer = require('../models/BusinessAnswer');
const User = require('../models/user/User');
const { userPublicFieldsString } = require('../utils/populate-utils');
const userController = require('./userController');
const { getCachedBusinessReviewers } = require('../databases/redis/queries/business.queries');
const { updateUserTotalHelpfulVotes } = require('../databases/redis/queries/user.queries');

const getMostHelpfulAnswerToQuestion = async (q_id, { returnDoc = false }) => {
  try {
    const mostHelpfulData = await BusinessAnswer.aggregate([
      { $match: { question: mongoose.Types.ObjectId(q_id) } },
      { $project: { likesCount: { $size: '$likes' } } },
      { $sort: { likesCount: -1 } },
      { $limit: 1 },
    ]);
    console.log(mostHelpfulData); // { _id, likesCount }

    if (!mostHelpfulData.length || mostHelpfulData[0]?.likesCount === 0) return null;
    if (!returnDoc) return mostHelpfulData[0]._id;

    return await BusinessAnswer.findById(mostHelpfulData?.[0]?._id).populate(
      'answeredBy',
      userPublicFieldsString
    );
  } catch (err) {
    console.log(err);
    res.json(err);
  }
};

exports.askQuestionAboutBusiness = async (req, res) => {
  const { businessId } = req.params;
  const paragraphs = req.body.question?.split('\n');

  try {
    if (!(await Business.findById(businessId)))
      return res.status(404).json({ status: 'FAIL', msg: 'Business not found' });

    // In the future, check if the loggedin user owns this business. If so, dont allow him to ask question.

    const newQuestion = await BusinessQuestion.create({
      questionText: paragraphs,
      askedBy: req.user._id,
      business: businessId,
    });

    await userController.addUserContribution(
      req.user._id,
      newQuestion._id,
      'BusinessQuestion'
    );

    res.status(201).json({
      status: 'SUCCESS',
      question: await newQuestion.populate([
        { path: 'askedBy', select: userPublicFieldsString },
        { path: 'business', select: 'businessName city stateCode' },
      ]),
    });
  } catch (err) {
    console.log(err);
    res.json({ error: err });
  }
};

exports.getQuestionsAskedAboutBusiness = async (req, res) => {
  const { page = 1, limit } = req.query;
  const skip = limit * (page - 1);

  console.log('Req url for getQuestionsAskedAboutBusiness: ', req.url);

  try {
    console.log({ 'req.query': req.query });
    let sort = req.query.sort?.split(',').join(' ').trim() || '';

    const business = await Business.findById(req.params.businessId);
    if (!business) return res.status(404).json({ status: 'NOT_FOUND' });

    const [questionsCount, questions] = await Promise.all([
      BusinessQuestion.find({ business: req.params.businessId }).count(),
      BusinessQuestion.find({ business: req.params.businessId })
        .sort(sort)
        .select('-business')
        .skip(skip)
        .limit(limit)
        .populate([
          { path: 'askedBy', select: userPublicFieldsString },
          {
            path: 'answers',
            populate: { path: 'answeredBy', select: userPublicFieldsString },
          },
        ]),
    ]);

    if (sort?.includes('-answersCount')) {
      questions.sort((prev, next) => next.answers.length - prev.answers.length);
    }

    res.status(200).json({
      status: 'SUCCESS',
      total: questionsCount,
      data: questions,
    });
  } catch (err) {
    console.log(err);
    res.json({ error: err });
  }
};

exports.getQuestionDetails = async (req, res, next) => {
  const filters = { _id: req.params.id };

  const question = await BusinessQuestion.findOne(filters).populate([
    { path: 'business', select: 'businessName city stateCode' },
    { path: 'askedBy', select: userPublicFieldsString },
    {
      path: 'answers',
      populate: { path: 'answeredBy', select: 'firstName lastName imgUrl role' },
    },
  ]);

  if (!question) return res.status(404).json({ status: 'NOT_FOUND' });

  const qObj = question.toObject();
  qObj.business.reviewers = await getCachedBusinessReviewers(qObj.business._id);
  return res.status(200).json({ status: 'SUCCESS', question: qObj });
};

exports.addAnswerToQuestionAboutBusiness = async (req, res) => {
  const paragraphs = req.body.answer?.split('\n');
  console.log('Adding new answer to question#', req.params.id);
  try {
    const newAnswer = await BusinessAnswer.create({
      question: req.params.id,
      answerText: paragraphs,
      answeredBy: req.user._id,
    });
    const update = { $push: { answers: newAnswer._id } };
    const options = { runValidators: true, new: true };

    const question = await BusinessQuestion.findByIdAndUpdate(
      req.params.id,
      update,
      options
    ).populate([
      { path: 'askedBy', select: userPublicFieldsString },
      {
        path: 'answers',
        populate: { path: 'answeredBy', select: userPublicFieldsString },
      },
    ]);

    await userController.addUserContribution(req.user._id, newAnswer._id, 'BusinessAnswer');

    res.status(200).json({
      status: 'SUCCESS',
      question,
      newAnswer: await BusinessAnswer.findById(newAnswer._id).populate(
        'answeredBy',
        userPublicFieldsString
      ),
    });
  } catch (err) {
    console.log(err);
    res.json({ error: err });
  }
};

exports.getAnswersToQuestion = async (req, res, next) => {
  try {
    console.log('Req url in getAnswersToQuestion', req.url);
    const { page = 1, limit } = req.query;
    const skip = limit * (page - 1);

    if (!(await BusinessQuestion.findById(req.params.id))) {
      return res.status(404).json({ status: 'NOT_FOUND', msg: 'Invalid question ID' });
    }

    const [answers, allAnswersCount, mostHelpfulAnswerId] = await Promise.all([
      BusinessAnswer.find({ question: req.params.id })
        .sort('-createdAt')
        .skip(skip)
        .limit(limit)
        .populate('answeredBy', userPublicFieldsString),

      BusinessAnswer.find({ question: req.params.id }).count(),
      getMostHelpfulAnswerToQuestion(req.params.id, { returnDoc: false }),
    ]);

    res.status(200).json({
      status: 'SUCCESS',
      results: answers.length,
      total: allAnswersCount,
      mostHelpfulAnswerId,
      data: answers,
    });
  } catch (err) {
    console.log(err);
    res.json(err);
  }
};

exports.toggleLikeAnswerToBusinessQuestion = async (req, res) => {
  try {
    const question = await BusinessQuestion.findById(req.params.questionId).populate([
      { path: 'askedBy', select: userPublicFieldsString },
      'answers',
    ]);
    const answer = question.answers.find(a => a._id.toString() === req.params.answerId);
    const isDislikeRequest = answer.likes.includes(req.user._id);

    // If user has liked before
    if (isDislikeRequest) {
      answer.likes = answer.likes.filter(id => id.toString() !== req.user._id.toString());
    } else {
      answer.likes.push(req.user._id); // Add him to the array of likers
      answer.dislikes = answer.dislikes.filter(
        id => id.toString() !== req.user._id.toString()
      );
    }
    const [mostHelpfulAnswerId] = await Promise.all([
      getMostHelpfulAnswerToQuestion(req.params.questionId, {}),
      updateUserTotalHelpfulVotes(req.user._id, isDislikeRequest ? '-' : '+'),
      answer.save(),
    ]);
    const { likes, dislikes } = answer;
    res.json({ status: 'SUCCESS', likes, dislikes, mostHelpfulAnswerId });
  } catch (err) {
    console.log(err);
    res.json({ error: err });
  }
};

exports.toggleDislikeAnswerToBusinessQuestion = async (req, res) => {
  console.log('In toggleDislike');
  try {
    const question = await BusinessQuestion.findById(req.params.questionId).populate([
      { path: 'askedBy', select: userPublicFieldsString },
      'answers',
    ]);
    const answer = question.answers.find(a => a._id.toString() === req.params.answerId);

    // If user disliked before
    if (answer.dislikes.includes(req.user._id)) {
      answer.dislikes = answer.dislikes.filter(
        id => id.toString() !== req.user._id.toString()
      );
    } else {
      answer.dislikes.push(req.user._id); // Add him to the dislikers list
      answer.likes = answer.likes.filter(id => id.toString() !== req.user._id.toString());
    }

    await answer.save();
    const { likes, dislikes } = answer;

    res.json({
      status: 'SUCCESS',
      likes,
      dislikes,
      mostHelpfulAnswerId: await getMostHelpfulAnswerToQuestion(req.params.questionId, {}),
    });
  } catch (err) {
    console.log(err);
    res.json({ error: err });
  }
};
