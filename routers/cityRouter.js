const express = require('express');
const multer = require('multer');
const cityController = require('../controllers/cityController');
const cityCacheController = require('../controllers/cityCacheController');
const authController = require('../controllers/authController');
const City = require('../models/City');

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

router.route('/').get(cityController.getCities);
router.route('/search').get(
  // cityCacheController.searchCachedCities,
  cityController.searchCities
);

router.route('/all-states').get(cityController.getStateNames);

router
  .route('/:cityId/toggle-featured')
  .patch(
    authController.protect,
    authController.restrictToRoles('MAIN_ADMIN'),
    cityController.toggleCityFeatured
  );

router
  .route('/:cityId')
  .patch(
    authController.protect,
    authController.restrictToRoles('MAIN_ADMIN'),
    upload.single('photo'),
    cityController.resizeCityPhoto,
    cityController.updateCity
  );

////////// TEST ///////////
router.get('/modify/', async (req, res) => {
  const cities = await City.find({});
  res.json(cities);
});

module.exports = router;
