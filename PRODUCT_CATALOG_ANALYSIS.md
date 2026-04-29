# KA Imports Product Catalog - Code Analysis Report

## Overview
This report documents the product catalog/listing system in the ka-imports codebase, including fetching logic, loading states, error handling, and potential issues.

---

## 1. Product Catalog Components

### **Home Page - Main Product Listing**
**File:** [artifacts/ka-imports/src/pages/Home.tsx](artifacts/ka-imports/src/pages/Home.tsx)

**Key Features:**
- Main product listing page with filtering and search
- Uses React Query hook `useGetProducts()` to fetch all products
- Supports category filtering and text-based search
- Products are sorted by `sortOrder`, `isLaunch` status, and creation date

**Loading States:**
```tsx
{isLoading ? (
  <div className="flex flex-col items-center justify-center py-20">
    <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
    <p className="text-muted-foreground font-medium">Carregando catálogo...</p>
  </div>
) : isError ? (
  <div className="bg-destructive/5 text-destructive p-8 rounded-3xl text-center border-2 border-destructive/10">
    <p className="font-bold text-lg mb-2">Ops! Algo deu errado.</p>
    <p className="opacity-80">Não foi possível carregar os produtos. Tente recarregar a página.</p>
  </div>
)
```

**Error Handling:** ✅ Comprehensive
- Shows spinner during loading
- Displays error message if fetch fails
- Shows "no products" message when DB is empty
- Shows "no products found" when filters return zero results

---

### **Product Card Component**
**File:** [artifacts/ka-imports/src/components/product/ProductCard.tsx](artifacts/ka-imports/src/components/product/ProductCard.tsx)

**Key Features:**
- Displays individual product with image, price, and promotions
- Shows status badges:
  - `OFERTA` (promotion/discount)
  - `ESGOTADO` (sold out)
  - `LANCAMENTO` (launch/new product)
- Supports "Add to Cart" and "View Product" actions
- Image lazy loading: `loading="lazy"` and `decoding="async"`

**Status Checks:**
```tsx
const hasPromo = product.promoPrice != null && product.promoPrice < product.price;
const isSoldOut = isProductUnavailable(product);
const isLaunch = (product as Product & { isLaunch?: boolean }).isLaunch === true;
```

---

### **Product Detail Page**
**File:** [artifacts/ka-imports/src/pages/ProductDetail.tsx](artifacts/ka-imports/src/pages/ProductDetail.tsx)

**Key Features:**
- Shows detailed product information
- Uses `useGetProducts()` to fetch all products and filters by ID
- Seller-specific routing support (`/:seller/produto/:id` or `/produto/:id`)
- Stores seller code in localStorage/sessionStorage

**Loading States:**
```tsx
{isLoading ? (
  <div className="flex justify-center py-20">
    <Loader2 className="w-8 h-8 animate-spin text-primary" />
  </div>
) : isError ? (
  <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-6 text-center">
    <p className="font-semibold text-destructive">Erro ao carregar produto.</p>
  </div>
) : !product ? (
  <div className="rounded-2xl border border-border bg-card p-6 text-center">
    <p className="font-semibold text-foreground">Produto não encontrado.</p>
  </div>
)
```

---

## 2. API Calls & Hooks

### **Main Product Fetching Hook**
**File:** [lib/api-client-react/src/generated/api.ts](lib/api-client-react/src/generated/api.ts)

**Hook:** `useGetProducts()`
```tsx
export function useGetProducts<
  TData = Awaited<ReturnType<typeof getProducts>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<...>;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey }
```

**Endpoint:** `GET /api/products`

**Query Configuration:**
- Uses React Query (`@tanstack/react-query`)
- Returns `{ data, isLoading, isError }`
- Default options:
  - `retry: 1`
  - `refetchOnWindowFocus: false`

---

### **Backend Products Endpoint**
**File:** [artifacts/api-server/src/routes/products.ts](artifacts/api-server/src/routes/products.ts)

**Endpoint:** `GET /api/products`

**Logic:**
```tsx
router.get("/products", async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.isActive, true))
      .orderBy(desc(productsTable.isLaunch), asc(productsTable.createdAt));

    const products = rows.map((row) => mapProduct(row));
    const categories = [...new Set(products.map((p) => p.category))];
    res.json({ products, categories });
  } catch (err) {
    console.error("Products error:", err);
    res.json({ products: [], categories: [] });  // ⚠️ Returns empty on error
  }
});
```

**Response Format:**
```json
{
  "products": [
    {
      "id": "string",
      "name": "string",
      "description": "string",
      "price": number,
      "promoPrice": number | null,
      "image": string | null,
      "category": "string",
      "isActive": boolean,
      "isSoldOut": boolean,
      "isLaunch": boolean,
      "sortOrder": number,
      "createdAt": "ISO string"
    }
  ],
  "categories": ["string"]
}
```

---

### **Other Product-Related Fetches**

#### Header Search Component
**File:** [artifacts/ka-imports/src/components/layout/Header.tsx](artifacts/ka-imports/src/components/layout/Header.tsx#L38-L48)

```tsx
function useProducts() {
  const [products, setProducts] = useState<ProductSuggestion[]>([]);
  useEffect(() => {
    fetch(`${BASE}/api/products`)
      .then((r) => r.json())
      .then((data: { products?: ProductSuggestion[] }) => {
        setProducts(data.products ?? []);
      })
      .catch(() => {});  // ⚠️ Silent failure
  }, []);
  return products;
}
```

**Issue:** Silently fails with no error feedback

---

#### Checkout Page - Product Availability Check
**File:** [artifacts/ka-imports/src/pages/Checkout.tsx](artifacts/ka-imports/src/pages/Checkout.tsx#L320-L360)

```tsx
const validateCartAvailability = useCallback(async () => {
  // ... fetches /api/products
  try {
    const res = await fetch(`${BASE}/api/products`);
    if (!res.ok) return true;
    const data = await res.json() as { products?: Array<...> };
    
    const byId = new Map((data.products ?? []).map((product) => [product.id, product]));
    const unavailable = nonBumpItems.filter((item) => {
      const product = byId.get(item.id);
      return !product || isProductUnavailable(product);
    });

    if (unavailable.length === 0) return true;
    unavailable.forEach((item) => removeItem(item.id));
    toast.error(`Removemos itens indisponiveis do carrinho: ${names}.`);
    return false;
  } catch {
    return true;  // Allows checkout if fetch fails
  }
}, [items, removeItem]);
```

**Triggers:**
- Used in pending product check for seller checkout links
- Called when adding products via checkout links

---

## 3. Error Handling & Console Logs

### **Console Logs Found:**

1. **App.tsx - Error Boundary**
```tsx
console.error("[ErrorBoundary] Uncaught error:", error, info.componentStack);
```

2. **API Server - Product Error**
```tsx
console.error("Products error:", err);
```

3. **CustomerOrders.tsx - Order Detail Errors**
```tsx
console.error("Erro ao carregar detalhes:", err);
```

### **Toast Notifications for Users:**

| Location | Message | Condition |
|----------|---------|-----------|
| Home.tsx | "Ops! Algo deu errado." | isError flag set |
| ProductDetail.tsx | "Erro ao carregar produto." | isError flag set |
| ProductDetail.tsx | "Produto não encontrado." | !product after load |
| ProductDetail.tsx | "Este produto está esgotado." | isSoldOut |
| Checkout.tsx | "O produto do link está indisponível." | Product not found or unavailable |
| Header.tsx | (Silent failure) | Fetch fails |
| CustomerOrders.tsx | "Não foi possível carregar seus pedidos." | Load failed |

---

## 4. Loading States Analysis

### **Where Loading States Are Shown:**
1. ✅ **Home.tsx** - Shows spinner while fetching products
2. ✅ **ProductDetail.tsx** - Shows spinner while fetching
3. ✅ **Checkout.tsx** - Shows spinner while loading shipping options
4. ✅ **CustomerOrders.tsx** - Shows spinner while loading orders
5. ✅ **RaffleList.tsx** - Shows spinner while loading raffles

### **Potential Infinite Loading Issues:**

#### Issue 1: Header Search Component ⚠️
**File:** [Header.tsx](artifacts/ka-imports/src/components/layout/Header.tsx#L38-L48)
- No dependency array on `useEffect`, but runs once on mount
- Silent failure with no error handling
- No loading state displayed to user

#### Issue 2: Social Proof Widget ⚠️
**File:** [artifacts/ka-imports/src/components/SocialProofWidget.tsx](artifacts/ka-imports/src/components/SocialProofWidget.tsx#L61-L85)
- Fetches from `api/social-proof/feed` on mount
- Silent failure with `.catch(() => {})`
- No loading state shown to user
- Creates timers for card rotation - could cause memory leaks if not cleaned up properly

**Code:**
```tsx
useEffect(() => {
  fetch(`${import.meta.env.BASE_URL}api/social-proof/feed`)
    .then((r) => r.json())
    .then((data: Feed) => {
      // ... logic
    })
    .catch(() => {});  // ⚠️ Silent failure
}, []);
```

#### Issue 3: Checkout Pending Product Check ⚠️
**File:** [Checkout.tsx](artifacts/ka-imports/src/pages/Checkout.tsx#L350-L370)
- Fetches products but silently fails
- `setPendingCheck(false)` in finally block, so state is set correctly
- Good: Has error toast displayed to user

---

## 5. Product Availability Check Logic

### **isProductUnavailable Helper**
**File:** [artifacts/ka-imports/src/store/use-cart.ts](artifacts/ka-imports/src/store/use-cart.ts)

The helper checks if a product is unavailable:
```tsx
function isProductUnavailable(product: {
  isActive?: boolean;
  isSoldOut?: boolean;
  promoPrice?: number | null;
  promoEndsAt?: string | null;
}) {
  if (!product.isActive) return true;
  if (product.isSoldOut) return true;
  // Check if promo has expired
  if (product.promoEndsAt && new Date() > new Date(product.promoEndsAt)) {
    return true;  // Promo expired, item is unavailable
  }
  return false;
}
```

---

## 6. Product Filtering & Sorting

### **Filtering (Home.tsx):**
```tsx
const filteredProducts = useMemo(() => {
  if (!data?.products) return [];
  let filtered = data.products.filter((product) => {
    const matchesSearch = !searchQuery || 
      product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.description.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesCategory = activeCategories.length === 0 || 
      activeCategories.includes(product.category);
    
    const matchesName = !nameFilter.trim() ||
      product.name.toLowerCase().includes(nameFilter.trim().toLowerCase());

    return matchesSearch && matchesCategory && matchesName;
  });

  return filtered;
}, [data, searchQuery, activeCategories, nameFilter]);
```

### **Sorting (Backend + Frontend):**

**Backend (products.ts):**
1. Sort by `isLaunch` (launches first)
2. Then by `createdAt` (newest first)
3. Manual `sortOrder` override (positive values come first)

**Frontend (Home.tsx):**
1. Sort by `sortOrder` (manual position)
2. Then by `isLaunch` status
3. Then by `createdAt` (newest first)

---

## 7. Data Flow Diagram

```
User Opens Home Page
    ↓
useGetProducts() hook called
    ↓
fetch() → GET /api/products
    ↓
Backend queries productsTable
    ↓
Returns { products: [], categories: [] }
    ↓
React Query caches result
    ↓
Home Component receives { data, isLoading, isError }
    ↓
Applied Filters:
  - Category filter
  - Search query
  - Name filter
    ↓
Sorted Products displayed in grid
    ↓
Each ProductCard shows:
  - Image (lazy loaded)
  - Price (with promo if active)
  - Status badges (OFERTA, ESGOTADO, LANCAMENTO)
  - Add to cart button
```

---

## 8. Findings Summary

### ✅ **Good Practices:**
1. React Query for caching and automatic retry
2. Proper loading spinners in main pages
3. Error messages displayed to users
4. Toast notifications for user feedback
5. Lazy loading images with `loading="lazy"`
6. URL-based search query persistence
7. Seller code stored in localStorage for multi-tenant support
8. Comprehensive product unavailability checks
9. Order bumps and tier discounts logic

### ⚠️ **Issues Found:**

| Issue | Severity | Location | Description |
|-------|----------|----------|-------------|
| Silent fetch failure | Medium | Header.tsx (Search) | No error handling or user feedback |
| Silent fetch failure | Medium | SocialProofWidget.tsx | No error handling or user feedback |
| No error recovery | Low | Social Proof Widget | Timer cleanup could be better |
| Permissive error handling | Low | Checkout.tsx | Allows checkout if availability check fails |
| Generic error message | Low | API Server | Returns empty array on DB error |

### 🚀 **Performance Notes:**
- Products fetched once via React Query
- Reused in multiple places (Home, ProductDetail, Header search)
- Frontend filtering is efficient with useMemo
- Images use lazy loading
- No N+1 queries identified

---

## 9. Testing Checklist

- [ ] Test product fetch with network error
- [ ] Test product fetch with empty database
- [ ] Test filtering with no results
- [ ] Test product detail with non-existent ID
- [ ] Test sold-out product behavior
- [ ] Test promotion expiry logic
- [ ] Test header search with API failure
- [ ] Test social proof widget with API failure
- [ ] Test checkout with unavailable products
- [ ] Test lazy loading images on slow connection

