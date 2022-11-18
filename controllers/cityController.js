const cityQueries = require('../databases/redis/queries/city.queries');
const Business = require('../models/Business');

exports.searchCities = async (req, res, next) => {
  const { textQuery } = req.searchCitiesParams;

  try {
    // const cities = await Business.find({
    //   city: { $regex: `^${textQuery}.*`, $options: 'i' },
    // })
    //   .select('+city +stateCode')
    //   .distinct('city');
    let [cityQuery, stateQuery] = textQuery.split('-');
    [cityQuery, stateQuery] = [
      cityQuery.toLowerCase().trim(),
      stateQuery?.toUpperCase().trim(),
    ];

    const filters = {
      city: { $regex: new RegExp(`^${cityQuery}.*`, 'i') },
    };

    if (stateQuery) filters.stateCode = { $regex: new RegExp(`^${stateQuery}`, 'i') };
    console.log('Filters: ', filters);

    const [result] = await Business.aggregate([
      {
        $match: { ...filters },
      },
      {
        $project: { cityInState: { $concat: ['$city', ', ', '$stateCode'] } },
      },
      {
        $group: {
          _id: null,
          cities: { $addToSet: '$cityInState' },
        },
      },
      {
        $project: { _id: 0 },
      },
    ]);
    console.log({ result });

    if (!result?.cities) {
      return res.json({ status: 'SUCCESS', source: 'db', results: 0, cities: [] });
    }

    const { cities } = result;
    cityQueries.cacheCitySearchResults(cities);

    res.status(200).json({
      status: 'SUCCESS',
      source: 'db',
      results: cities.length,
      cities,
    });
  } catch (err) {
    console.log('Error: ', err);

    res.status(500).json({
      status: 'ERROR',
      source: 'db',
      msg: err.message,
    });
  }
};
