import { Link } from "react-router";
import { useState, useRef, useEffect } from "react";
import { motion, useScroll, useSpring, useTransform, AnimatePresence } from "motion/react";

const BLUE = "#1D63ED";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05, delayChildren: 0.2 },
  },
};

const letterVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.33, 1, 0.68, 1] },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: "easeOut" } },
};

function AnimatedTitle({ text, isBlue, italic }: { text: string; isBlue?: boolean; italic?: boolean }) {
  return (
    <motion.span
      className="inline-block whitespace-nowrap pt-4 -mt-4"
      variants={{ visible: { transition: { staggerChildren: 0.02 } } }}
    >
      {text.split("").map((char, i) => (
        <motion.span
          key={i}
          variants={letterVariants}
          whileHover={{ y: -5, color: BLUE, transition: { duration: 0.2, ease: "easeOut" } }}
          className={`inline-block cursor-default select-none transition-colors duration-300 ${
            italic ? "italic" : ""
          } ${isBlue ? `text-[${BLUE}]` : ""}`}
          style={isBlue ? { color: BLUE } : undefined}
        >
          {char === " " ? "\u00A0" : char}
        </motion.span>
      ))}
    </motion.span>
  );
}

export function LandingHero() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isReversing, setIsReversing] = useState(false);
  const heroRef = useRef(null);
  const { scrollY } = useScroll();
  const y1 = useTransform(scrollY, [0, 500], [0, 200]);
  const [isDemoHovered, setIsDemoHovered] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      if (!isReversing && video.currentTime >= video.duration - 0.5) {
        setIsReversing(true);
      } else if (isReversing && video.currentTime <= 0.5) {
        setIsReversing(false);
        video.play();
      }
    };

    const interval = setInterval(() => {
      if (isReversing && video) {
        video.pause();
        video.currentTime -= 0.06;
      }
    }, 33);

    video.addEventListener("timeupdate", handleTimeUpdate);
    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
      clearInterval(interval);
    };
  }, [isReversing]);

  return (
    <section
      ref={heroRef}
      className="relative min-h-[90vh] flex items-center bg-white overflow-hidden"
      style={{ borderBottom: "1px solid #e2e8f0" }}
    >
      <motion.div style={{ y: y1 }} className="absolute inset-0 z-0">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="w-full h-full object-cover grayscale opacity-[0.15]"
        >
          <source
            src="https://videos.pexels.com/video-files/27635999/12190293_640_360_60fps.mp4"
            type="video/mp4"
          />
        </video>
        <div className="absolute inset-0 bg-gradient-to-b from-white via-white/20 to-white" />
      </motion.div>

      <div className="container relative mx-auto px-4 z-10 pt-10 pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-20 items-center">
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="max-w-5xl"
          >
            <motion.div variants={itemVariants} className="flex items-center gap-4 mb-4">
              <div className="w-16 h-px" style={{ backgroundColor: BLUE }} />
              <span
                className="text-[10px] font-black uppercase tracking-[0.5em]"
                style={{ color: BLUE }}
              >
                Sovereign Digital Asset Infrastructure
              </span>
            </motion.div>

            <motion.h1
              className="text-7xl md:text-9xl mb-8 leading-[0.85] text-black tracking-tighter"
              style={{ fontFamily: "'Playfair Display', serif" }}
            >
              <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="flex flex-wrap gap-x-[0.2em]"
              >
                <AnimatedTitle text="The" />
                <AnimatedTitle text="Future" />
                <AnimatedTitle text="of" />
                <br className="w-full" />
                <AnimatedTitle text="Digital" isBlue italic />
                <AnimatedTitle text="Assets" isBlue italic />
                <AnimatedTitle text="today." />
              </motion.div>
            </motion.h1>

            <motion.p
              variants={itemVariants}
              className="text-xl md:text-3xl text-slate-500 max-w-3xl mb-12 leading-relaxed font-light"
              style={{ fontFamily: "'Inter', sans-serif" }}
            >
              Wrappdex delivers high-performance decentralized custody and liquidity settlement.
              Built on the Hedera network for ultimate transparency and institutional security.
            </motion.p>

            <motion.div variants={itemVariants} className="flex flex-wrap gap-8">
              <a href="mailto:Info@Wrappdex.io">
                <button
                  className="text-white font-black uppercase tracking-[0.2em] text-[10px] h-16 px-12 shadow-2xl transition-all hover:translate-y-[-2px] cursor-pointer"
                  style={{ backgroundColor: "black" }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = BLUE)}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "black")}
                >
                  Partner with Wrappdex
                </button>
              </a>
              <a href="#network">
                <button className="h-16 px-12 border border-slate-200 text-black font-black uppercase tracking-[0.2em] text-[10px] transition-all hover:border-black hover:bg-slate-50 cursor-pointer bg-transparent">
                  Explore the Network
                </button>
              </a>
            </motion.div>
          </motion.div>

          {/* Device Mockups */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.5, delay: 0.5, ease: "easeOut" }}
            className="relative hidden lg:block self-start -mt-20"
            style={{ perspective: "1000px" }}
          >
            <Link
              to="/markets"
              onMouseEnter={() => setIsDemoHovered(true)}
              onMouseLeave={() => setIsDemoHovered(false)}
              className="block relative group cursor-pointer"
            >
              {/* Desktop Display */}
              <motion.div
                whileHover={{ rotateY: -8, rotateX: 4, scale: 1.05 }}
                className="relative z-10 bg-white p-2 rounded-xl overflow-hidden transition-all duration-1000"
                style={{
                  boxShadow: "0 50px 100px -20px rgba(0,0,0,0.3)",
                  border: "1px solid #e2e8f0",
                }}
              >
                <div className="absolute top-0 left-0 w-full h-8 bg-slate-50 flex items-center px-4 gap-1.5 z-20" style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <div className="w-2.5 h-2.5 rounded-full bg-red-400/20" />
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-400/20" />
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-400/20" />
                </div>

                <div className="relative mt-8 aspect-[16/10] overflow-hidden">
                  <motion.img
                    animate={{ opacity: isDemoHovered ? 0 : 1 }}
                    transition={{ duration: 0.8 }}
                    src="https://cdn.builder.io/api/v1/image/assets%2F40d47a8a19594e8684b17f309e3be30d%2Fa435b5aec2fa449f86195390644e6c3c?format=webp&width=1200&height=800"
                    alt="Wrappdex PC Dashboard Dark"
                    className="absolute inset-0 w-full h-full object-cover grayscale-[0.2] brightness-105"
                  />
                  <motion.img
                    animate={{ opacity: isDemoHovered ? 1 : 0 }}
                    transition={{ duration: 0.8 }}
                    src="https://cdn.builder.io/api/v1/image/assets%2F40d47a8a19594e8684b17f309e3be30d%2F4ca2792db7904675b4b4dea98f3fff3e?format=webp&width=1200&height=800"
                    alt="Wrappdex PC Dashboard Light"
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                </div>

                <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-1000" />
              </motion.div>

              {/* Mobile Display */}
              <motion.div
                animate={{ y: isDemoHovered ? [0, -25, 0] : [0, -15, 0] }}
                transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
                whileHover={{ scale: 1.15, rotateZ: -3, x: 20 }}
                className="absolute -top-12 -right-12 z-20 w-52 bg-slate-950 p-2 rounded-[2.5rem] overflow-hidden transition-all duration-700"
                style={{
                  boxShadow: "0 40px 80px -15px rgba(0,0,0,0.5)",
                  border: "6px solid #1e293b",
                }}
              >
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-20 h-5 bg-slate-800 rounded-b-2xl z-30 shadow-inner" />
                <div className="relative aspect-[9/19.5] rounded-[2rem] overflow-hidden">
                  <motion.img
                    animate={{ opacity: isDemoHovered ? 0 : 1 }}
                    transition={{ duration: 0.8 }}
                    src="https://cdn.builder.io/api/v1/image/assets%2F40d47a8a19594e8684b17f309e3be30d%2F2df0a2593cfa4b7da863b25119e980ec?format=webp&width=800&height=1600"
                    alt="Wrappdex Mobile App Dark"
                    className="absolute inset-0 w-full h-full object-cover brightness-110"
                  />
                  <motion.img
                    animate={{ opacity: isDemoHovered ? 1 : 0 }}
                    transition={{ duration: 0.8 }}
                    src="https://cdn.builder.io/api/v1/image/assets%2F40d47a8a19594e8684b17f309e3be30d%2F55e0b5bf11714aeaa90649c312569ccd?format=webp&width=800&height=1600"
                    alt="Wrappdex Mobile App Light"
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                </div>
              </motion.div>

              {/* Hover Overlay */}
              <div className="absolute inset-0 flex items-center justify-center z-40 pointer-events-none">
                <motion.div
                  animate={{
                    opacity: isDemoHovered ? 1 : 0,
                    y: isDemoHovered ? 0 : 20,
                    scale: isDemoHovered ? 1 : 0.9,
                  }}
                  className="bg-white/95 backdrop-blur-xl px-12 py-6 pointer-events-auto"
                  style={{ border: "1px solid #e2e8f0", boxShadow: "0 30px 60px -15px rgba(0,0,0,0.3)" }}
                >
                  <span className="text-[12px] font-black uppercase tracking-[0.5em] text-black">
                    Enter Platform
                  </span>
                </motion.div>
              </div>

              {/* Particle effect on hover */}
              <AnimatePresence>
                {isDemoHovered && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 -z-10 pointer-events-none"
                  >
                    {[...Array(6)].map((_, i) => (
                      <motion.div
                        key={i}
                        initial={{ x: 0, y: 0, opacity: 0 }}
                        animate={{
                          x: (i % 2 === 0 ? 1 : -1) * (50 + i * 20),
                          y: -(40 + i * 30),
                          opacity: [0, 0.4, 0],
                          scale: [0.5, 1.2, 0.5],
                        }}
                        transition={{
                          duration: 2 + i * 0.5,
                          repeat: Infinity,
                          ease: "easeOut",
                        }}
                        className="absolute left-1/2 top-1/2 w-1 h-1 rounded-full blur-[1px]"
                        style={{ backgroundColor: BLUE }}
                      />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </Link>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
