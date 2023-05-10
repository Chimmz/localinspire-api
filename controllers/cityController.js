const fs = require('fs');
const sharp = require('sharp');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const City = require('../models/City');
const cloudinaryService = require('../services/cloudinaryService');
const arrayUtils = require('../utils/arrayUtils');
const { toTitleCase } = require('../utils/string-utils');

// exports.searchCities = async (req, res, next) => {
//   const { textQuery } = req.searchCitiesParams || req.query;

//   try {
//     // const cities = await Business.find({
//     //   city: { $regex: `^${textQuery}.*`, $options: 'i' },
//     // })
//     //   .select('+city +stateCode')
//     //   .distinct('city');
//     let [cityQuery, stateQuery] = textQuery.split('-');

//     [cityQuery, stateQuery] = [
//       toTitleCase(cityQuery.toLowerCase().trim()),
//       stateQuery?.toUpperCase().trim(),
//     ];
//     console.log({ cityQuery, stateQuery });

//     const filters = { city: { $regex: `^${cityQuery}` } };

//     if (stateQuery) filters.stateCode = { $regex: `^${stateQuery}` };

//     const [result] = await Business.aggregate([
//       { $match: filters },
//       { $project: { cityInState: { $concat: ['$city', ', ', '$stateCode'] } } },
//       { $group: { _id: null, cities: { $addToSet: '$cityInState' } } },
//       { $project: { _id: 0 } },
//     ]);

//     if (!result?.cities) {
//       return res.json({ status: 'SUCCESS', source: 'db', results: 0, cities: [] });
//     }

//     // Cache matching cities
//     let { cities } = result;
//     console.log({ cities });

//     if (cities.length) {
//       cities.sort((prev, next) => prev.length - next.length); // In asc order of string length
//       await cityQueries.cacheCitySearchResults(cities);
//     }

//     res.status(200).json({ status: 'SUCCESS', source: 'db', results: cities.length, cities });
//   } catch (err) {
//     console.log('Error: ', err);

//     res.status(500).json({
//       status: 'ERROR',
//       source: 'db',
//       msg: err.message,
//     });
//   }
// };

exports.getCities = async (req, res) => {
  // const { page = 1, limit = 20 } = req.query;

  if (!req.query.page) req.query.page = 1;
  if (!req.query.limit) req.query.limit = 20;
  if (req.query.isFeatured === 'true') req.query.isFeatured = true;
  else if (req.query.isFeatured === 'false') req.query.isFeatured = false;

  const { page, limit } = req.query;
  const skip = limit * (page - 1);
  // const skip = (req.query.limit || 20) * ((req.query.page || 1) - 1);

  try {
    const [total, cities] = await Promise.all([
      City.find().count(),
      City.find(req.query).skip(skip).limit(limit),
    ]);
    res.status(200).json({
      status: 'SUCCESS',
      results: cities.length,
      total,
      cities,
    });
  } catch (err) {
    console.log('Error: ', err);

    res.status(500).json({
      status: 'ERROR',
      msg: err.message,
    });
  }
};

exports.searchCities = async (req, res, next) => {
  try {
    const [nameQuery, stateCodeQuery] = req.query.textQuery.split('-');
    const filter = {};

    if (nameQuery) filter.name = { $regex: `^${toTitleCase(nameQuery.trim())}` };

    if (stateCodeQuery)
      filter.stateCode = { $regex: `^${stateCodeQuery.toUpperCase().trim()}` };

    const [result] = await City.aggregate([
      { $match: filter },
      { $sort: { searchesCount: -1 } },
      { $project: { cityAndState: { $concat: ['$name', ', ', '$stateCode'] } } },
      { $group: { _id: null, cities: { $push: '$cityAndState' } } },
      { $project: { _id: 0 } },
    ]);

    res.status(200).json({ results: result.cities?.length, cities: result.cities });
  } catch (err) {
    console.log(err);
    res.status(400).json({ error: err.message });
  }
};

exports.toggleCityFeatured = async (req, res) => {
  try {
    const city = await City.findById(req.params.cityId).select('isFeatured');
    city.isFeatured = !city.isFeatured;

    await city.save({ validateBeforeSave: false });
    res.status(200).json({ status: 'SUCCESS', city });
  } catch (err) {
    console.log(err);
    res.status(400).json({ error: err.message });
  }
};

exports.getStateNames = async (req, res) => {
  try {
    const stateNames = await City.find({}).select('stateName').distinct('stateName');
    res.status(200).json({ status: 'SUCCESS', results: stateNames.length, stateNames });
  } catch (err) {
    console.log(err);
    res.status(400).json({ error: err.message });
  }
};

exports.resizeCityPhoto = async (req, res, next) => {
  try {
    console.log({ 'req.file': req.file });
    if (!req.file) return next();

    // Validate uploaded photo
    if (!req.file.mimetype.startsWith('image'))
      return res.status(400).json({
        status: 'FAIL',
        msg: `Uploaded file of type ${req.file.mimetype} is not an image`,
      });

    // Store image in filesystem
    const filePath = `public/img/cities/city-${req.params.cityId}-${Date.now()}.jpeg`;

    // Resize photo
    const sharpResult = await sharp(req.file.buffer)
      .resize(2000, 1333)
      .jpeg({ quality: 90 })
      .toFormat('jpeg')
      .toFile(filePath);

    console.log({ sharpResult });

    // Upload photo to Cloudinary server
    const uploadResult = await cloudinaryService.upload({ dir: 'cities', filePath });
    console.log({ uploadResult });

    if ('secure_url' in uploadResult) req.body.imgUrl = uploadResult.secure_url;

    // Delete file from our server
    fs.unlink(filePath, err => {
      console.log(
        err ? 'Could not delete city photo from server' : 'City photo deleted successfully'
      );
    });
    next();
  } catch (err) {
    console.log(err);
    res.status(400).json({ error: err.message });
  }
};

exports.updateCity = async (req, res) => {
  try {
    const city = await City.findById(req.params.cityId);

    if (!city)
      return res.status(404).json({ status: 'ERROR', msg: 'Invalid city ID specified' });

    if (isNaN(+req.body.price))
      return res
        .status(400)
        .json({ status: 'FAIL', msg: `'${req.body.price}' is an invalid price` });

    if (req.body.price) {
      const stripePrices = await stripe.prices.list({ expand: ['data.product'] });

      const existingStripePrice = stripePrices.data.find(pr => {
        return (
          pr.nickname.startsWith('city_price_') &&
          +pr.unit_amount_decimal / 100 === +req.body.price
        );
      });

      if (!existingStripePrice) {
        const cityClaimProduct = stripePrices.data.find(price =>
          price.product.name.toLowerCase().includes('city claim')
        ).product;

        // Create a new price
        const newPrice = await stripe.prices.create({
          unit_amount: +req.body.price * 100,
          nickname: `city_price_$${req.body.price}`,
          currency: 'usd',
          recurring: { interval: 'month' },
          product: cityClaimProduct.id,
        });

        city.price = {
          amount: +req.body.price,
          currency: newPrice.currency,
          stripePriceId: newPrice.id,
          stripePriceNickname: newPrice.nickname,
        };
      } else {
        city.price = {
          amount: +req.body.price,
          currency: existingStripePrice.currency,
          stripePriceId: existingStripePrice.id,
          stripePriceNickname: existingStripePrice.nickname,
        };
      }
      await city.save();
    }

    delete req.body.price; // So that it doesn't cause validation error

    const updatedCity = await City.findByIdAndUpdate(city._id, req.body, { new: true });
    res.status(200).json({
      status: 'SUCCESS',
      msg: `${city.name} has been updated successfully`,
      city: updatedCity,
    });
  } catch (err) {
    console.log(err);
    res.status(400).json({ status: '400', error: err.message });
  }
};


// exports.increaseTotalCitySearches = async (req, res) => {
//   const { cityName, stateCode } = req.query;

//   const city = await City.find({
//     name: { $regex: `^${cityName.trim()}`, $options: 'i' },
//     stateCode: stateCode.toUpperCase(),
//   }).select('searchesCount');
//   res.json(city);
// };
