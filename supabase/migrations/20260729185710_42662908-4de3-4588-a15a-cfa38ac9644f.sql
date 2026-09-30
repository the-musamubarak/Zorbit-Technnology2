-- ROLES
create type public.app_role as enum ('admin','staff');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(auth.uid(), 'admin')
$$;

create policy "own profile" on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "own profile update" on public.profiles for update to authenticated using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
create policy "admin insert profile" on public.profiles for insert to authenticated with check (public.is_admin());

create policy "read roles" on public.user_roles for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "admin manage roles" on public.user_roles for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant insert, update, delete on public.user_roles to authenticated;

-- signup trigger
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), new.email)
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'staff')
  on conflict do nothing;
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- CATEGORIES
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.categories to authenticated;
grant all on public.categories to service_role;
alter table public.categories enable row level security;
create policy "read categories" on public.categories for select to authenticated using (true);
create policy "admin write categories" on public.categories for all to authenticated using (public.is_admin()) with check (public.is_admin());

create table public.category_attributes (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete cascade,
  attr_name text not null,
  attr_label text not null,
  input_type text not null default 'text' check (input_type in ('text','dropdown','number')),
  options text[],
  is_required boolean not null default false,
  display_order int not null default 0
);
grant select, insert, update, delete on public.category_attributes to authenticated;
grant all on public.category_attributes to service_role;
alter table public.category_attributes enable row level security;
create policy "read cat attrs" on public.category_attributes for select to authenticated using (true);
create policy "admin write cat attrs" on public.category_attributes for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- PRODUCTS
create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id),
  name text not null,
  brand text,
  sku text unique,
  cost_price numeric(12,2),
  selling_price numeric(12,2) not null,
  image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.products to authenticated;
grant all on public.products to service_role;
alter table public.products enable row level security;
create policy "read products" on public.products for select to authenticated using (true);
create policy "admin write products" on public.products for all to authenticated using (public.is_admin()) with check (public.is_admin());

create table public.product_attributes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete cascade,
  attr_name text not null,
  attr_value text not null
);
grant select, insert, update, delete on public.product_attributes to authenticated;
grant all on public.product_attributes to service_role;
alter table public.product_attributes enable row level security;
create policy "read product attrs" on public.product_attributes for select to authenticated using (true);
create policy "admin write product attrs" on public.product_attributes for all to authenticated using (public.is_admin()) with check (public.is_admin());

create table public.inventory (
  product_id uuid primary key references public.products(id) on delete cascade,
  quantity int not null default 0,
  reorder_level int not null default 5,
  updated_at timestamptz not null default now()
);
grant select, update on public.inventory to authenticated;
grant all on public.inventory to service_role;
alter table public.inventory enable row level security;
create policy "read inventory" on public.inventory for select to authenticated using (true);
create policy "admin adjust inventory" on public.inventory for update to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.create_inventory_row()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.inventory (product_id) values (new.id) on conflict do nothing;
  return new;
end; $$;
create trigger products_inventory_row after insert on public.products
for each row execute function public.create_inventory_row();

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id),
  change_type text not null check (change_type in ('purchase','sale','adjustment','return','void')),
  quantity_change int not null,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
grant select on public.stock_movements to authenticated;
grant all on public.stock_movements to service_role;
alter table public.stock_movements enable row level security;
create policy "admin read movements" on public.stock_movements for select to authenticated using (public.is_admin());

-- SUPPLIERS / PURCHASES
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  address text,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.suppliers to authenticated;
grant all on public.suppliers to service_role;
alter table public.suppliers enable row level security;
create policy "admin suppliers" on public.suppliers for all to authenticated using (public.is_admin()) with check (public.is_admin());

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references public.suppliers(id),
  purchase_date date not null default current_date,
  total_cost numeric(12,2),
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.purchases to authenticated;
grant all on public.purchases to service_role;
alter table public.purchases enable row level security;
create policy "admin purchases" on public.purchases for all to authenticated using (public.is_admin()) with check (public.is_admin());

create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid references public.purchases(id) on delete cascade,
  product_id uuid references public.products(id),
  quantity int not null,
  unit_cost numeric(12,2) not null
);
grant select, insert, update, delete on public.purchase_items to authenticated;
grant all on public.purchase_items to service_role;
alter table public.purchase_items enable row level security;
create policy "admin purchase items" on public.purchase_items for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- CUSTOMERS
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  email text,
  address text,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.customers to authenticated;
grant all on public.customers to service_role;
alter table public.customers enable row level security;
create policy "read customers" on public.customers for select to authenticated using (true);
create policy "insert customers" on public.customers for insert to authenticated with check (true);
create policy "admin update customers" on public.customers for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin delete customers" on public.customers for delete to authenticated using (public.is_admin());

-- SALES
create table public.sales (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id),
  sold_by uuid references auth.users(id) default auth.uid(),
  total_amount numeric(12,2),
  payment_method text check (payment_method in ('cash','transfer','pos')),
  status text not null default 'completed' check (status in ('completed','voided')),
  void_reason text,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.sales to authenticated;
grant all on public.sales to service_role;
alter table public.sales enable row level security;
create policy "read sales" on public.sales for select to authenticated using (sold_by = auth.uid() or public.is_admin());
create policy "insert own sales" on public.sales for insert to authenticated with check (sold_by = auth.uid());
create policy "admin void sales" on public.sales for update to authenticated using (public.is_admin()) with check (public.is_admin());

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid references public.sales(id) on delete cascade,
  product_id uuid references public.products(id),
  quantity int not null,
  unit_price numeric(12,2) not null
);
grant select, insert on public.sale_items to authenticated;
grant all on public.sale_items to service_role;
alter table public.sale_items enable row level security;
create policy "read sale items" on public.sale_items for select to authenticated
  using (exists (select 1 from public.sales s where s.id = sale_id and (s.sold_by = auth.uid() or public.is_admin())));
create policy "insert sale items" on public.sale_items for insert to authenticated
  with check (exists (select 1 from public.sales s where s.id = sale_id and s.sold_by = auth.uid()));

-- immutability guard on sales
create or replace function public.guard_sale_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.total_amount is distinct from old.total_amount
     or new.customer_id is distinct from old.customer_id
     or new.sold_by is distinct from old.sold_by
     or new.payment_method is distinct from old.payment_method then
    raise exception 'Only the sale status may be changed after creation';
  end if;
  if old.status = 'voided' and new.status <> 'voided' then
    raise exception 'A voided sale cannot be reinstated';
  end if;
  return new;
end; $$;
create trigger sales_guard before update on public.sales
for each row execute function public.guard_sale_update();

-- stock triggers
create or replace function public.apply_sale_item()
returns trigger language plpgsql security definer set search_path = public as $$
declare cur int;
begin
  select quantity into cur from public.inventory where product_id = new.product_id for update;
  if cur is null then
    insert into public.inventory (product_id, quantity) values (new.product_id, 0);
    cur := 0;
  end if;
  if cur < new.quantity then
    raise exception 'Insufficient stock for product %', new.product_id;
  end if;
  update public.inventory set quantity = quantity - new.quantity, updated_at = now()
    where product_id = new.product_id;
  insert into public.stock_movements (product_id, change_type, quantity_change, note, created_by)
    values (new.product_id, 'sale', -new.quantity, 'Sale '||new.sale_id, auth.uid());
  return new;
end; $$;
create trigger sale_items_stock after insert on public.sale_items
for each row execute function public.apply_sale_item();

create or replace function public.restore_voided_sale()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.status = 'voided' and old.status <> 'voided' then
    for r in select product_id, quantity from public.sale_items where sale_id = new.id loop
      update public.inventory set quantity = quantity + r.quantity, updated_at = now()
        where product_id = r.product_id;
      insert into public.stock_movements (product_id, change_type, quantity_change, note, created_by)
        values (r.product_id, 'void', r.quantity, coalesce(new.void_reason,'Sale voided'), auth.uid());
    end loop;
  end if;
  return new;
end; $$;
create trigger sales_void_restore after update on public.sales
for each row execute function public.restore_voided_sale();

create or replace function public.apply_purchase_item()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.inventory (product_id, quantity) values (new.product_id, new.quantity)
    on conflict (product_id) do update set quantity = public.inventory.quantity + excluded.quantity, updated_at = now();
  insert into public.stock_movements (product_id, change_type, quantity_change, note, created_by)
    values (new.product_id, 'purchase', new.quantity, 'Purchase '||new.purchase_id, auth.uid());
  return new;
end; $$;
create trigger purchase_items_stock after insert on public.purchase_items
for each row execute function public.apply_purchase_item();
