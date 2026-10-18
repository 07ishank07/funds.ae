import {defineCliConfig} from 'sanity/cli'

export default defineCliConfig({
  api: {
    projectId: process.env.SANITY_STUDIO_PROJECT_ID,
    dataset: process.env.SANITY_STUDIO_DATASET || 'production',
  },
  // `npm run deploy` publishes the Studio to https://<studioHost>.sanity.studio
  studioHost: process.env.SANITY_STUDIO_HOST || undefined,
  deployment: {
    autoUpdates: false,
  },
  // The Studio needs no PostCSS. Setting it inline stops Vite searching parent folders,
  // where an unrelated postcss.config file (e.g. in Downloads/) would break the build.
  vite: (config) => ({...config, css: {...config.css, postcss: {plugins: []}}}),
})
