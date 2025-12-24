const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  email: { type: String, trim: true },
  phone: { type: String, trim: true },
  city: String,
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ["admin", "manager", "engineer", "technician", "organisation"],
    default: "technician"
  },
  isApproved: {
    type: Boolean,
    default: false
  },
  resetPasswordToken: String,
  resetPasswordExpires: Date
}, { timestamps: true });

/* 🔐 HASH PASSWORD BEFORE SAVE */
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
    return next();
  }

  try {
    this.password = await bcrypt.hash(this.password, 10);
    next();
  } catch (err) {
    next(err);
  }
});

/* 🔍 COMPARE PASSWORD */
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model("User", userSchema);
