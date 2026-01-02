const mongoose = require("mongoose");
const City = require("./models/City"); // adjust path if needed

const MONGO_URI = "mongodb://127.0.0.1:27017/your_db_name"; 
// OR your MongoDB Atlas URI

const cities = [
  { name: "Lucknow", state: "Uttar Pradesh" },
  { name: "Delhi", state: "Delhi" },
  { name: "Mumbai", state: "Maharashtra" },
  { name: "Bangalore", state: "Karnataka" },
  { name: "Hyderabad", state: "Telangana" },
  { name: "Ghaziabad", state: "Uttar Pradesh" },
  { name: "Bareilly", state: "Uttar Pradesh" },
  { name: "Sitapur", state: "Uttar Pradesh" },
  { name: "Lakhimpur", state: "Uttar Pradesh" },
  { name: "Ayodhya", state: "Uttar Pradesh" },
  { name: "Varanasi", state: "Uttar Pradesh" },
  { name: "Gonda", state: "Uttar Pradesh" },
  { name: "Akbarpur", state: "Uttar Pradesh" },
  { name: "Ambedkar Nagar", state: "Uttar Pradesh" }
];

async function seedCities() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("MongoDB connected");

    await City.deleteMany(); // ⚠️ optional (removes old cities)
    await City.insertMany(cities);

    console.log("✅ Cities inserted successfully");
    process.exit();
  } catch (err) {
    console.error("❌ Error inserting cities:", err);
    process.exit(1);
  }
}

seedCities();
