const mongoose = require('mongoose');

const citySchema = new mongoose.Schema(
  {
    name: String,
    stateCode: { type: String, maxlength: 2 },
    stateName: { type: String },
    stateId: String,
    population: String,
    lat: String,
    lng: String,
    density: String,
    zips: String,

    price: {
      amount: { type: Number, default: 0.0 },
      currency: String,
      stripePriceId: String,
      stripePriceNickname: String,
    },
    imgUrl: { type: String, default: '/img/default-city-img.png' }, // This default img exists in the frontend
    isFeatured: { type: Boolean, default: false },
    searchesCount: { type: Number, default: 0 },
  },
  { toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

const City = new mongoose.model('City', citySchema);
module.exports = City;
