
const WINDOW_SIZE = 36;
const FORECAST_HOURS = 24;
const BOUND_PERCENT = 0.10;

function doGet(e) {
  return ContentService.createTextOutput("ESP32 Forecast System is running");
}

function doPost(e) {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(20000);

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("SensorData");

    if (!sheet) {
      sheet = ss.insertSheet("SensorData");
      sheet.appendRow(["Timestamp", "Temperature", "Humidity"]);
    }

    const data = JSON.parse(e.postData.contents);
    const temperature = Number(data.temperature);
    const humidity = Number(data.humidity);

    if (
      !Number.isFinite(temperature) ||
      !Number.isFinite(humidity) ||
      temperature < -40 ||
      temperature > 80 ||
      humidity < 0 ||
      humidity > 100
    ) {
      throw new Error("Invalid sensor data");
    }

    sheet.appendRow([new Date(), temperature, humidity]);
    SpreadsheetApp.flush();

    const forecastResult = generateForecastsCore_();

    return ContentService
      .createTextOutput(JSON.stringify({
        status: "success",
        forecastStatus: forecastResult.success ? "updated" : forecastResult.message
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({
        status: "error",
        message: error.message
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } finally {
    if (lock.hasLock()) {
      lock.releaseLock();
    }
  }
}

function generateForecasts() {
  const result = generateForecastsCore_();

  SpreadsheetApp.getUi().alert(
    result.success ? "Forecast updated successfully!" : result.message
  );
}

function generateForecastsCore_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sensorSheet = ss.getSheetByName("SensorData");

  if (!sensorSheet || sensorSheet.getLastRow() < 2) {
    return { success: false, message: "No sensor data available." };
  }

  let forecastSheet = ss.getSheetByName("Forecasts");

  if (!forecastSheet) {
    forecastSheet = ss.insertSheet("Forecasts");
  }

  const headers = [
    "Timestamp",
    "Temperature Forecast",
    "Temperature Upper Bound",
    "Temperature Lower Bound",
    "Humidity Forecast",
    "Humidity Upper Bound",
    "Humidity Lower Bound"
  ];

  forecastSheet.getRange(1, 1, 1, 7).setValues([headers]);

  const lastRow = sensorSheet.getLastRow();
  const startRow = Math.max(2, lastRow - 499);
  const data = sensorSheet
    .getRange(startRow, 1, lastRow - startRow + 1, 3)
    .getValues();

  const validData = data
    .filter(row =>
      row[0] instanceof Date &&
      !isNaN(row[0].getTime()) &&
      Number.isFinite(Number(row[1])) &&
      Number.isFinite(Number(row[2])) &&
      Number(row[1]) >= -40 &&
      Number(row[1]) <= 80 &&
      Number(row[2]) >= 0 &&
      Number(row[2]) <= 100
    )
    .sort((a, b) => a[0] - b[0]);

  if (validData.length === 0) {
    return { success: false, message: "No valid sensor readings found." };
  }

  const recentData = validData.slice(-WINDOW_SIZE);

  const temperatures = recentData.map(row => Number(row[1]));
  const humidities = recentData.map(row => Number(row[2]));

  const lastTimestamp = recentData[recentData.length - 1][0];

  const temperatureForecast = calculateRecursiveSMA(
    temperatures,
    FORECAST_HOURS
  );

  const humidityForecast = calculateRecursiveSMA(
    humidities,
    FORECAST_HOURS
  );

  const output = [];

  for (let i = 0; i < FORECAST_HOURS; i++) {
    const temp = roundValue(temperatureForecast[i]);
    const humidity = roundValue(
      Math.max(0, Math.min(100, humidityForecast[i]))
    );

    output.push([
      new Date(lastTimestamp.getTime() + (i + 1) * 60 * 60 * 1000),
      temp,
      roundValue(temp * (1 + BOUND_PERCENT)),
      roundValue(temp * (1 - BOUND_PERCENT)),
      humidity,
      roundValue(Math.min(100, humidity * (1 + BOUND_PERCENT))),
      roundValue(Math.max(0, humidity * (1 - BOUND_PERCENT)))
    ]);
  }

  if (forecastSheet.getLastRow() > 1) {
    forecastSheet
      .getRange(2, 1, forecastSheet.getLastRow() - 1, 7)
      .clearContent();
  }

  forecastSheet
    .getRange(2, 1, output.length, 7)
    .setValues(output);

  forecastSheet
    .getRange(2, 1, output.length, 1)
    .setNumberFormat("dd/MM/yyyy HH:mm");

  forecastSheet
    .getRange(2, 2, output.length, 6)
    .setNumberFormat("0.00");

  SpreadsheetApp.flush();

  return { success: true };
}

function calculateRecursiveSMA(values, forecastHours) {
  const workingValues = values.slice();
  const forecasts = [];

  for (let i = 0; i < forecastHours; i++) {
    const forecast = calculateSMA(workingValues, WINDOW_SIZE);
    forecasts.push(forecast);
    workingValues.push(forecast);
  }

  return forecasts;
}

function calculateSMA(values, windowSize) {
  const recentValues = values.slice(-windowSize);

  const total = recentValues.reduce(
    (sum, value) => sum + value,
    0
  );

  return total / recentValues.length;
}

function roundValue(value) {
  return Math.round(value * 100) / 100;
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Forecast System")
    .addItem("Generate Forecast", "generateForecasts")
    .addToUi();
}

function clearData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sensorSheet = ss.getSheetByName("SensorData");
  const forecastSheet = ss.getSheetByName("Forecasts");

  if (sensorSheet && sensorSheet.getLastRow() > 1) {
    sensorSheet
      .getRange(2, 1, sensorSheet.getLastRow() - 1, 3)
      .clearContent();
  }

  if (forecastSheet && forecastSheet.getLastRow() > 1) {
    forecastSheet
      .getRange(2, 1, forecastSheet.getLastRow() - 1, 7)
      .clearContent();
  }
}
