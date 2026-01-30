# Project TODO

- [x] Update `api.ts` - Change `export_format` to `'csv'`
- [x] Resolve Home.tsx merge conflicts from template upgrade
- [x] Create backend proxy route for CSV download to fix CORS
- [x] Write and pass tests for proxy endpoint
- [x] Fix 400 error when calling backend proxy - correct tRPC API call format
- [x] Add loading progress indicator for CSV download
- [x] Track download progress percentage in backend
- [x] Display progress in UI during fetch
- [x] Remove SavedPresets component from UI
- [x] Fix "Cannot read properties of undefined (reading 'readable')" CSV parsing error
- [ ] Update CSV mapping to use correct field for Catalog Purchases (converted_product_omni_purchase)
- [ ] Test full CSV download and filtering workflow end-to-end
- [x] Debug and fix persistent 'readable' error after CSV download
- [x] Debug why CSV data is not being displayed in UI after download - fixed duplicate error variable
