/* eslint-disable */

'use strict';

var _stringify = require('babel-runtime/core-js/json/stringify');

var _stringify2 = _interopRequireDefault(_stringify);

var _slicedToArray2 = require('babel-runtime/helpers/slicedToArray');

var _slicedToArray3 = _interopRequireDefault(_slicedToArray2);

var _entries = require('babel-runtime/core-js/object/entries');

var _entries2 = _interopRequireDefault(_entries);

var _typeof2 = require('babel-runtime/helpers/typeof');

var _typeof3 = _interopRequireDefault(_typeof2);

var _toConsumableArray2 = require('babel-runtime/helpers/toConsumableArray');

var _toConsumableArray3 = _interopRequireDefault(_toConsumableArray2);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var fs = require('fs');

function getFeatures(data) {
  var features = [];
  if (data.length && data.forEach) {
    data.forEach(function (d) {
      features.push.apply(features, (0, _toConsumableArray3.default)(getFeatures(d)));
    });
  } else if (data.features) {
    features.push.apply(features, (0, _toConsumableArray3.default)(data.features));
  } else if ((typeof data === 'undefined' ? 'undefined' : (0, _typeof3.default)(data)) === 'object') {
    (0, _entries2.default)(data).forEach(function (_ref) {
      var _ref2 = (0, _slicedToArray3.default)(_ref, 2),
          k = _ref2[0],
          d = _ref2[1];

      features.push.apply(features, (0, _toConsumableArray3.default)(getFeatures(d)));
    });
  }
  return features;
}

fs.readdirSync('.').filter(function (f) {
  return (/dump.json/.test(f)
  );
})
//.filter(f => /ce#1000/.test(f))
.forEach(function (filename) {
  var data = require('./' + filename);
  var features = getFeatures(data);
  console.log(filename + ' has ' + features.length + ' features');

  var samFile = filename.replace('.dump.json', '.sam');
  if (fs.existsSync(samFile)) {
    console.log(filename + ' has a sam file');
    var sequences = {};
    fs.readFileSync(samFile).toString('ascii').split('\n').forEach(function (line) {
      var fields = line.split('\t');
      var name = fields[0];
      var seq = fields[9];
      if (!sequences[name]) sequences[name] = [];
      sequences[name].push(seq);
    });

    // if (sequences.s0c) {
    //   console.log(sequences.s0c)
    // }

    var replaced = false;
    features.forEach(function (feature) {
      var samSeq = sequences[feature.readName] && sequences[feature.readName][0];
      if (feature.readBases === '*') {
        delete feature.readBases;
        replaced = true;
      }
      if (samSeq) {
        if (samSeq !== feature.readBases) replaced = true;
        if (samSeq === '*') {
          delete feature.readBases;
        } else {
          feature.readBases = samSeq;
        }
        // console.log(`${feature.readName} = ${samSeq}`)
        sequences[feature.readName].shift();
      }
    });
    if (replaced) {
      fs.writeFileSync(filename, (0, _stringify2.default)(data, null, '  '));
    }
  } else {
    console.log(filename + ' has no sam file');
  }
});
