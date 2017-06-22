/*
 * Copyright (C) 2017 Alasdair Mercer, !ninja
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

'use strict';

var async = require('async');
var exitHook = require('exit-hook');
var Gpio = require('onoff').Gpio;

/**
 * The number of pixels.
 *
 * @public
 * @type {number}
 */
var NUM_PIXELS = 8;

var clearOnExit = true;
var pixels = (function() {
  var results = [];

  for (var i = 0; i < NUM_PIXELS; i++) {
    results.push([ 0, 0, 0, 7 ]);
  }

  return results;
}());
var clk, dat;

/**
 * Clears the pixel buffer.
 *
 * @return {void}
 * @public
 */
function clear() {
  for (var i = 0; i < NUM_PIXELS; i++) {
    pixels[i].splice(0, 3, 0, 0, 0);
  }
}

/**
 * Gets the RGB and brightness values of the pixel at the <code>index</code>
 * provided.
 *
 * @param {number} index - the horizontal position of the pixel (between 0 and 7 - inclusive)
 * @return {number[]} An array containing the pixel information (red, green, blue, brightness).
 * @throws {RangeError} If <code>index</code> is less than 0 or greater than 7.
 * @throws {TypeError} If <code>index</code> is <code>null</code> or not a number.
 * @public
 */
function getPixel(index) {
  validateIndex(index);

  var pixel = pixels[index].slice();
  pixel[3] = parseFloat((pixel[3] / 31).toPrecision(3));

  return pixel;
}

/**
 * Sets the specified RGB values, and optionally <code>brightness</code>, of all pixels.
 *
 * If you don't supply a <code>brightness</code> value, the last value set for each pixel be kept.
 *
 * @param {number} red - the amount of red to be set (between 0 and 255 - inclusive)
 * @param {number} green - the amount of green to be set (between 0 and 255 - inclusive)
 * @param {number} blue - the amount of blue to be set (between 0 and 255 - inclusive)
 * @param {number} [brightness] - the brightness to be set (between 0 and 1 - inclusive)
 * @return {void}
 * @throws {RangeError} If <code>brightness</code> is less than 0 or greater than 1 or any color is less than 0 or
 * greater than 255.
 * @throws {TypeError} If any color is <code>null</code> or not a number, or <code>brightness</code> is not a number.
 * @public
 */
function setAll(red, green, blue, brightness) {
  validateRGB(red, green, blue);
  validateBrightness(brightness, true);

  for (var i = 0; i < NUM_PIXELS; i++) {
    setPixelInternal(i, red, green, blue, brightness);
  }
}

/**
 * Sets the brightness of all pixels to <code>brightness</code>.
 *
 * @param {number} brightness - the brightness to be set (between 0 and 1 - inclusive)
 * @return {void}
 * @throws {RangeError} If <code>brightness</code> is less than 0 or greater than 1.
 * @throws {TypeError} If <code>brightness</code> is <code>null</code> or not a number.
 * @public
 */
function setBrightness(brightness) {
  validateBrightness(brightness, false);

  for (var i = 0; i < NUM_PIXELS; i++) {
    pixels[i][3] = toBrightnessValue(brightness);
  }
}

/**
 * Sets whether Blinkt! should be cleared upon exit.
 *
 * By default, Blinkt! will turn off all of the pixels on exit, but calling <code>blinkt.setClearOnExit(false)</code>
 * will ensure that it does not.
 *
 * @param {boolean} [value=true] - <code>true</code> to clear pixels on exit; otherwise <code>false</code>
 * @return {void}
 * @public
 */
function setClearOnExit(value) {
  clearOnExit = value == null || value === true;
}

/**
 * Sets the specified RGB values, and optionally <code>brightness</code>, of the pixel at the <code>index</code>
 * provided.
 *
 * If you don't supply a <code>brightness</code> value, the last value set will be kept.
 *
 * @param {number} index - the horizontal position of the pixel (between 0 and 7 - inclusive)
 * @param {number} red - the amount of red to be set (between 0 and 255 - inclusive)
 * @param {number} green - the amount of green to be set (between 0 and 255 - inclusive)
 * @param {number} blue - the amount of blue to be set (between 0 and 255 - inclusive)
 * @param {number} [brightness] - the brightness to be set (between 0 and 1 - inclusive)
 * @return {void}
 * @throws {RangeError} If <code>index</code> is less than 0 or greather than 7, <code>brightness</code> is less than 0
 * or greater than 1, or any color is less than 0 or greater than 255.
 * @throws {TypeError} If <code>index</code> or any color are <code>null</code> or not a number, or
 * <code>brightness</code> is not a number.
 * @public
 */
function setPixel(index, red, green, blue, brightness) {
  validateIndex(index);
  validateRGB(red, green, blue);
  validateBrightness(brightness, true);

  setPixelInternal(index, red, green, blue, brightness);
}

/**
 * Outputs the buffer to Blinkt!
 *
 * @param {Function} callback - the callback function to be called once the pixels have been shown
 * @return {void}
 * @public
 */
function show(callback) {
  if (dat == null && clk == null) {
    dat = new Gpio(23, 'out');
    clk = new Gpio(24, 'out');
  }

  async.series([
    sof,
    function(next) {
      async.eachSeries(pixels, function(pixel, done) {
        async.series([
          async.apply(writeByte, 0xe0 | pixel[3]),
          async.apply(writeByte, pixel[2]),
          async.apply(writeByte, pixel[1]),
          async.apply(writeByte, pixel[0])
        ], done);
      }, next);
    },
    eof
  ], callback);
}

function cleanup() {
  dat.unexport();
  clk.unexport();
}

function eof(callback) {
  /*
   * Emit exactly enough clock pulses to latch the small dark die APA102s which are weird for some reason it takes 36
   * clocks, the other IC takes just 4 (number of pixels/2).
   */
  async.series([
    dat.write.bind(dat, 0),
    function(next) {
      async.timesSeries(36, function(i, done) {
        async.series([
          clk.write.bind(clk, 1),
          clk.write.bind(clk, 0)
        ], done);
      }, next);
    }
  ], callback);
}

function exit() {
  if (clearOnExit) {
    clear();
    show();
  }

  cleanup();
}

function setPixelInternal(index, red, green, blue, brightness) {
  pixels[index] = [
    toColorValue(red),
    toColorValue(green),
    toColorValue(blue),
    brightness != null ? toBrightnessValue(brightness) : pixels[index][3]
  ];
}

function sof(callback) {
  async.series([
    dat.write.bind(dat, 0),
    function(next) {
      async.timesSeries(32, function(i, done) {
        async.series([
          clk.write.bind(clk, 1),
          clk.write.bind(clk, 0)
        ], done);
      }, next);
    }
  ], callback);
}

function toBrightnessValue(brightness) {
  return Math.floor(31 * brightness) & 0x1f;
}

function toColorValue(color) {
    return Math.floor(color) & 0xff;
}

function validateBrightness(brightness, nullable) {
  validateInput('brightness', brightness, 0, 1, nullable);
}

function validateIndex(index) {
  validateInput('index', index, 0, NUM_PIXELS - 1, false);
}

function validateInput(name, value, min, max, nullable) {
  if (value == null) {
    if (!nullable) {
      throw new TypeError(name + ' must not be null');
    }
  } else if (typeof value !== 'number' || value !== +value) {
    throw new TypeError(name + ' must be a number but was ' + value);
  } else if (value < min || value > max) {
    throw new RangeError(name + ' must be between ' + min + ' and ' + max + ' (inclusive) but was ' + value);
  }
}

function validateRGB(red, green, blue) {
  validateInput('red', red, 0, 255, false);
  validateInput('green', green, 0, 255, false);
  validateInput('blue', blue, 0, 255, false);
}

function writeByte(byte, callback) {
  async.timesSeries(8, function(i, next) {
    async.series([
      dat.write.bind(dat, byte & 0x80 ? 1 : 0),
      clk.write.bind(clk, 1),
      clk.write.bind(clk, 0)
    ], next);

    byte <<= 1;
  }, callback);
}

exitHook(exit);

module.exports = {
  NUM_PIXELS: NUM_PIXELS,
  clear: clear,
  getPixel: getPixel,
  setAll: setAll,
  setBrightness: setBrightness,
  setClearOnExit: setClearOnExit,
  setPixel: setPixel,
  show: show
};
